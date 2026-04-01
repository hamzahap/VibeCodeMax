import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { runConfiguredAgent } from "./agents.js";
import { buildAuditPrompt, type TemplateVariables } from "./prompts.js";
import { ensureDirectory, writeJson } from "./process.js";
import type {
  AuditDecision,
  AuditPacket,
  NormalizedConfig,
  NormalizedAgentProfile,
  VerificationResult,
  WorkspaceSnapshot,
} from "./types.js";

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function buildVerificationFailureSummary(results: VerificationResult[]): string[] {
  return results
    .filter((result) => result.exitCode !== 0)
    .map((result) => `${result.name} failed with exit ${result.exitCode}.`);
}

function createRequiredFileReport(
  workspace: string,
  requiredFiles: string[],
): Promise<Array<{ path: string; exists: boolean }>> {
  return Promise.all(
    requiredFiles.map(async (relativePath) => ({
      path: relativePath,
      exists: await fileExists(path.resolve(workspace, relativePath)),
    })),
  );
}

export async function buildAuditPacket(input: {
  config: NormalizedConfig;
  attempt: number;
  previousFeedback?: string;
  primaryResult: AuditPacket["primaryResult"];
  verificationResults: VerificationResult[];
  workspaceSnapshot: WorkspaceSnapshot;
  attemptsUsed: number;
  elapsedMinutes: number;
  estimatedUsd: number;
  estimatedTokens: number;
}): Promise<AuditPacket> {
  const requiredFiles = await createRequiredFileReport(
    input.config.workspace,
    input.config.run.requiredFiles,
  );

  return {
    attempt: input.attempt,
    task: input.config.task,
    previousFeedback: input.previousFeedback,
    primaryResult: input.primaryResult,
    verificationResults: input.verificationResults,
    workspaceSnapshot: input.workspaceSnapshot,
    requiredFiles,
    budgets: {
      attemptsUsed: input.attemptsUsed,
      maxAttempts: input.config.budgets.maxAttempts,
      elapsedMinutes: input.elapsedMinutes,
      maxRuntimeMinutes: input.config.budgets.maxRuntimeMinutes,
      estimatedUsd: input.estimatedUsd,
      maxUsd: input.config.budgets.maxUsd,
      estimatedTokens: input.estimatedTokens,
      maxTokens: input.config.budgets.maxTokens,
    },
  };
}

export async function runHeuristicAudit(
  packet: AuditPacket,
): Promise<AuditDecision> {
  const reasons: string[] = [];
  const verificationFailures = buildVerificationFailureSummary(packet.verificationResults);
  reasons.push(...verificationFailures);

  if (packet.primaryResult.exitCode !== 0) {
    reasons.push(`Primary agent exited with code ${packet.primaryResult.exitCode}.`);
  }

  const missingFiles = packet.requiredFiles.filter((file) => !file.exists);
  if (missingFiles.length > 0) {
    reasons.push(`Missing required files: ${missingFiles.map((file) => file.path).join(", ")}.`);
  }

  if (packet.workspaceSnapshot.isGitRepo && packet.workspaceSnapshot.changedFiles.length === 0) {
    reasons.push("No workspace changes detected.");
  }

  if (reasons.length === 0) {
    return {
      decision: "complete",
      summary:
        "Primary agent exited cleanly, required files exist, and all configured verification commands passed.",
      source: "heuristic",
    };
  }

  return {
    decision: "continue",
    summary: reasons.join(" "),
    nextPrompt: [
      "Address the unresolved issues and finish the task completely.",
      ...verificationFailures,
      missingFiles.length > 0
        ? `Create or update the required files: ${missingFiles.map((file) => file.path).join(", ")}.`
        : "",
      packet.workspaceSnapshot.changedFiles.length === 0 ? "Make concrete workspace changes." : "",
    ]
      .filter(Boolean)
      .join(" "),
    source: "heuristic",
  };
}

function parseAuditJson(rawOutput: string): AuditDecision {
  const parsed = JSON.parse(rawOutput) as Record<string, unknown>;
  const decision = parsed.decision;
  const summary = parsed.summary;
  const nextPrompt = parsed.nextPrompt;

  if ((decision !== "complete" && decision !== "continue") || typeof summary !== "string") {
    throw new Error("Auditor output JSON must include decision and summary.");
  }

  return {
    decision,
    summary,
    nextPrompt: typeof nextPrompt === "string" && nextPrompt.trim() ? nextPrompt : undefined,
    rawOutput,
    source: "external",
  };
}

export async function runExternalAuditor(input: {
  config: NormalizedConfig;
  agent: NormalizedAgentProfile;
  attempt: number;
  attemptDirectory: string;
  packet: AuditPacket;
  variables: TemplateVariables;
}): Promise<AuditDecision> {
  const { config, agent, attempt, attemptDirectory, packet, variables } = input;
  await ensureDirectory(attemptDirectory);

  const auditPacketFile = path.join(attemptDirectory, "audit-packet.json");
  const auditPromptFile = path.join(attemptDirectory, "audit-prompt.md");

  await writeJson(auditPacketFile, packet);

  const auditPrompt = buildAuditPrompt({
    config,
    attempt,
    auditPacketFile,
  });

  await writeFile(auditPromptFile, `${auditPrompt}\n`, "utf8");

  const renderedVariables: TemplateVariables = {
    ...variables,
    AUDIT_PACKET_FILE: auditPacketFile,
    PROMPT_FILE: auditPromptFile,
    ROLE: "auditor",
    MODEL: agent.model ?? "",
  };

  const result = await runConfiguredAgent({
    agent,
    variables: renderedVariables,
    role: "auditor",
  });

  await writeJson(path.join(attemptDirectory, "audit-command-result.json"), result);

  if (result.exitCode !== 0) {
    return {
      decision: "continue",
      summary: `Auditor command failed with exit ${result.exitCode}. Falling back to another attempt.`,
      nextPrompt: "The auditor command failed. Continue and leave a clearer result for auditing.",
      rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
      source: "fallback",
    };
  }

  try {
    return parseAuditJson(result.stdout.trim());
  } catch (error) {
    return {
      decision: "continue",
      summary: `Auditor output was not valid JSON: ${(error as Error).message}`,
      nextPrompt: "Return a more obviously complete result. The auditor could not confidently mark this done.",
      rawOutput: result.stdout.trim(),
      source: "fallback",
    };
  }
}
