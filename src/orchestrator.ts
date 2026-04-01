import { writeFile } from "node:fs/promises";
import path from "node:path";
import { runConfiguredAgent } from "./agents.js";
import { buildAuditPacket, runExternalAuditor, runHeuristicAudit } from "./auditor.js";
import { loadConfig } from "./config.js";
import { collectWorkspaceSnapshot } from "./git.js";
import {
  buildPrimaryPrompt,
  loadContextSnippets,
  renderTemplate,
  type TemplateVariables,
} from "./prompts.js";
import { ensureDirectory, formatDuration, runShellCommand, writeJson } from "./process.js";
import type {
  AttemptRecord,
  AuditDecision,
  NormalizedAgentProfile,
  RunSummary,
  VerificationResult,
} from "./types.js";

export interface Logger {
  info(message: string): void;
}

interface BudgetState {
  attempts: number;
  totalEstimatedUsd: number;
  totalEstimatedTokens: number;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function timestampForDirectory(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function buildTemplateVariables(input: {
  attempt: number;
  role: string;
  workspace: string;
  runDir: string;
  promptFile: string;
  auditPacketFile?: string;
  model?: string;
  taskTitle: string;
  objective: string;
  configFile: string;
}): TemplateVariables {
  return {
    ATTEMPT: String(input.attempt),
    ROLE: input.role,
    WORKSPACE: input.workspace,
    RUN_DIR: input.runDir,
    PROMPT_FILE: input.promptFile,
    AUDIT_PACKET_FILE: input.auditPacketFile ?? "",
    MODEL: input.model ?? "",
    TASK_TITLE: input.taskTitle,
    OBJECTIVE: input.objective,
    CONFIG_FILE: input.configFile,
  };
}

function applyAgentCost(profile: NormalizedAgentProfile, state: BudgetState): void {
  state.totalEstimatedUsd += profile.estimatedCostUsdPerRun ?? 0;
  state.totalEstimatedTokens += profile.estimatedTokensPerRun ?? 0;
}

async function runVerification(input: {
  verification: Array<{
    name: string;
    command: string;
    cwd: string;
    continueOnFailure?: boolean;
  }>;
  variables: TemplateVariables;
}): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (const command of input.verification) {
    const result = await runShellCommand(renderTemplate(command.command, input.variables), {
      cwd: command.cwd,
      env: {
        VCM_ATTEMPT: input.variables.ATTEMPT,
        VCM_ROLE: "verification",
        VCM_WORKSPACE: input.variables.WORKSPACE,
        VCM_RUN_DIR: input.variables.RUN_DIR,
        VCM_PROMPT_FILE: input.variables.PROMPT_FILE,
        VCM_AUDIT_PACKET_FILE: input.variables.AUDIT_PACKET_FILE,
        VCM_MODEL: input.variables.MODEL,
        VCM_TASK_TITLE: input.variables.TASK_TITLE,
        VCM_OBJECTIVE: input.variables.OBJECTIVE,
        VCM_CONFIG_FILE: input.variables.CONFIG_FILE,
      },
    });

    const verificationResult: VerificationResult = {
      ...result,
      name: command.name,
      continueOnFailure: command.continueOnFailure ?? false,
    };

    results.push(verificationResult);

    if (verificationResult.exitCode !== 0 && !verificationResult.continueOnFailure) {
      break;
    }
  }

  return results;
}

function summarizeVerification(results: VerificationResult[]): string {
  if (results.length === 0) {
    return "No verification commands configured.";
  }

  const passed = results.filter((result) => result.exitCode === 0).length;
  const failed = results.length - passed;
  return `${passed} passed, ${failed} failed.`;
}

function summarizeBudgetReason(configMax?: number, label?: string): string {
  return configMax === undefined
    ? `${label ?? "Budget"} exhausted.`
    : `${label ?? "Budget"} limit reached (${configMax}).`;
}

function evaluateBudgetStop(input: {
  state: BudgetState;
  startedAtMs: number;
  budgets: {
    maxAttempts?: number;
    maxRuntimeMinutes?: number;
    maxUsd?: number;
    maxTokens?: number;
  };
}): string | undefined {
  const elapsedMinutes = (Date.now() - input.startedAtMs) / 60_000;

  if (
    input.budgets.maxAttempts !== undefined &&
    input.state.attempts >= input.budgets.maxAttempts
  ) {
    return summarizeBudgetReason(input.budgets.maxAttempts, "Attempt");
  }

  if (
    input.budgets.maxRuntimeMinutes !== undefined &&
    elapsedMinutes >= input.budgets.maxRuntimeMinutes
  ) {
    return summarizeBudgetReason(input.budgets.maxRuntimeMinutes, "Runtime");
  }

  if (input.budgets.maxUsd !== undefined && input.state.totalEstimatedUsd >= input.budgets.maxUsd) {
    return summarizeBudgetReason(input.budgets.maxUsd, "USD");
  }

  if (
    input.budgets.maxTokens !== undefined &&
    input.state.totalEstimatedTokens >= input.budgets.maxTokens
  ) {
    return summarizeBudgetReason(input.budgets.maxTokens, "Token");
  }

  return undefined;
}

export async function runFromConfig(configPath: string, logger: Logger): Promise<RunSummary> {
  const config = await loadConfig(configPath);
  const startedAt = new Date();
  const startedAtMs = Date.now();
  const runDirectory = path.join(
    config.run.artifactsDir,
    `${timestampForDirectory()}-${slugify(config.task.title) || "run"}`,
  );

  await ensureDirectory(runDirectory);
  await writeJson(path.join(runDirectory, "normalized-config.json"), config);

  const contextSnippets = await loadContextSnippets(config);

  const budgetState: BudgetState = {
    attempts: 0,
    totalEstimatedUsd: 0,
    totalEstimatedTokens: 0,
  };

  const records: AttemptRecord[] = [];
  let previousFeedback: string | undefined;
  let previousVerificationResults: VerificationResult[] = [];
  let lastDiffHash: string | undefined;
  let noChangeStreak = 0;

  logger.info(`Workspace: ${config.workspace}`);
  logger.info(`Artifacts: ${runDirectory}`);

  while (true) {
    const preAttemptStopReason = evaluateBudgetStop({
      state: budgetState,
      startedAtMs,
      budgets: config.budgets,
    });

    if (preAttemptStopReason) {
      const finishedAt = new Date();
      const summary: RunSummary = {
        status: "budget_exhausted",
        reason: preAttemptStopReason,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        attempts: budgetState.attempts,
        totalDurationMs: finishedAt.getTime() - startedAtMs,
        totalEstimatedUsd: budgetState.totalEstimatedUsd,
        totalEstimatedTokens: budgetState.totalEstimatedTokens,
        runDirectory,
        workspace: config.workspace,
        lastAudit: records.at(-1)?.auditDecision,
        records,
      };

      await writeJson(path.join(runDirectory, "run-summary.json"), summary);
      return summary;
    }

    budgetState.attempts += 1;
    const attempt = budgetState.attempts;
    const attemptStartedAt = new Date().toISOString();
    const attemptDirectory = path.join(runDirectory, `attempt-${String(attempt).padStart(3, "0")}`);
    await ensureDirectory(attemptDirectory);

    logger.info(`Attempt ${attempt}${config.budgets.maxAttempts ? `/${config.budgets.maxAttempts}` : ""}`);

    const promptFile = path.join(attemptDirectory, "primary-prompt.md");
    const prompt = buildPrimaryPrompt({
      config,
      attempt,
      previousFeedback,
      previousVerificationResults,
      contextSnippets,
    });

    await writeFile(promptFile, `${prompt}\n`, "utf8");

    const primaryAgent = config.agents[config.run.primaryAgent]!;
    const primaryVariables = buildTemplateVariables({
      attempt,
      role: "primary",
      workspace: config.workspace,
      runDir: runDirectory,
      promptFile,
      model: primaryAgent.model,
      taskTitle: config.task.title,
      objective: config.task.objective,
      configFile: config.configPath,
    });

    const primaryResult = await runConfiguredAgent({
      agent: primaryAgent,
      variables: primaryVariables,
      role: "primary",
    });
    applyAgentCost(primaryAgent, budgetState);

    await writeJson(path.join(attemptDirectory, "primary-result.json"), primaryResult);
    logger.info(
      `Primary agent exit ${primaryResult.exitCode} in ${formatDuration(primaryResult.durationMs)}`,
    );

    const verificationResults = await runVerification({
      verification: config.run.verification,
      variables: primaryVariables,
    });
    await writeJson(path.join(attemptDirectory, "verification-results.json"), verificationResults);
    logger.info(`Verification: ${summarizeVerification(verificationResults)}`);

    const workspaceSnapshot = await collectWorkspaceSnapshot(config.workspace, [
      config.run.artifactsDir,
      runDirectory,
    ]);
    await writeJson(path.join(attemptDirectory, "workspace-snapshot.json"), workspaceSnapshot);
    logger.info(`Workspace snapshot: ${workspaceSnapshot.summary}`);

    if (workspaceSnapshot.isGitRepo) {
      if (workspaceSnapshot.diffHash === lastDiffHash) {
        noChangeStreak += 1;
      } else {
        noChangeStreak = 0;
        lastDiffHash = workspaceSnapshot.diffHash;
      }
    } else {
      noChangeStreak = 0;
      lastDiffHash = undefined;
    }

    const auditPacket = await buildAuditPacket({
      config,
      attempt,
      previousFeedback,
      primaryResult,
      verificationResults,
      workspaceSnapshot,
      attemptsUsed: budgetState.attempts,
      elapsedMinutes: (Date.now() - startedAtMs) / 60_000,
      estimatedUsd: budgetState.totalEstimatedUsd,
      estimatedTokens: budgetState.totalEstimatedTokens,
    });

    let auditDecision: AuditDecision;

    if (config.run.auditorAgent) {
      const auditorAgent = config.agents[config.run.auditorAgent]!;
      applyAgentCost(auditorAgent, budgetState);
      auditDecision = await runExternalAuditor({
        config,
        agent: auditorAgent,
        attempt,
        attemptDirectory,
        packet: auditPacket,
        variables: primaryVariables,
      });
    } else {
      auditDecision = await runHeuristicAudit(auditPacket);
      await writeJson(path.join(attemptDirectory, "audit-packet.json"), auditPacket);
    }

    await writeJson(path.join(attemptDirectory, "audit-result.json"), auditDecision);
    logger.info(`Audit: ${auditDecision.decision} | ${auditDecision.summary}`);

    const record: AttemptRecord = {
      attempt,
      startedAt: attemptStartedAt,
      promptFile,
      primaryResult,
      verificationResults,
      workspaceSnapshot,
      auditDecision,
    };

    records.push(record);

    if (auditDecision.decision === "complete") {
      const finishedAt = new Date();
      const summary: RunSummary = {
        status: "completed",
        reason: auditDecision.summary,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        attempts: budgetState.attempts,
        totalDurationMs: finishedAt.getTime() - startedAtMs,
        totalEstimatedUsd: budgetState.totalEstimatedUsd,
        totalEstimatedTokens: budgetState.totalEstimatedTokens,
        runDirectory,
        workspace: config.workspace,
        lastAudit: auditDecision,
        records,
      };

      await writeJson(path.join(runDirectory, "run-summary.json"), summary);
      return summary;
    }

    previousFeedback = auditDecision.nextPrompt || auditDecision.summary;
    previousVerificationResults = verificationResults;

    if (noChangeStreak >= config.run.maxNoChangeAttempts) {
      const finishedAt = new Date();
      const summary: RunSummary = {
        status: "stopped",
        reason: `No meaningful diff change across ${config.run.maxNoChangeAttempts} consecutive retry attempts.`,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        attempts: budgetState.attempts,
        totalDurationMs: finishedAt.getTime() - startedAtMs,
        totalEstimatedUsd: budgetState.totalEstimatedUsd,
        totalEstimatedTokens: budgetState.totalEstimatedTokens,
        runDirectory,
        workspace: config.workspace,
        lastAudit: auditDecision,
        records,
      };

      await writeJson(path.join(runDirectory, "run-summary.json"), summary);
      return summary;
    }
  }
}
