import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { runConfiguredAgent } from "./agents.js";
import { buildAuditPrompt, type TemplateVariables } from "./prompts.js";
import { ensureDirectory, writeJson } from "./process.js";
import { summarizeTaskSnippets } from "./task-files.js";
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
  taskScope?: AuditPacket["taskScope"];
  taskFiles?: AuditPacket["taskFiles"];
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
    taskScope: input.taskScope,
    taskFiles: input.taskFiles,
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
  const noWorkspaceChanges =
    packet.workspaceSnapshot.isGitRepo && packet.workspaceSnapshot.changedFiles.length === 0;
  const taskFileSummaries = summarizeTaskSnippets(packet.taskFiles ?? []);
  reasons.push(...verificationFailures);

  if (packet.primaryResult.exitCode !== 0) {
    reasons.push(`Primary agent exited with code ${packet.primaryResult.exitCode}.`);
  }

  const missingFiles = packet.requiredFiles.filter((file) => !file.exists);
  if (missingFiles.length > 0) {
    reasons.push(`Missing required files: ${missingFiles.map((file) => file.path).join(", ")}.`);
  }

  const unreadableTaskFiles = taskFileSummaries.filter((summary) => summary.unreadable);
  if (unreadableTaskFiles.length > 0) {
    reasons.push(
      `Configured task tracking files could not be read: ${unreadableTaskFiles.map((summary) => summary.path).join(", ")}.`,
    );
  }

  const unresolvedTaskFiles = taskFileSummaries.filter((summary) => summary.uncheckedCount > 0);
  if (unresolvedTaskFiles.length > 0) {
    reasons.push(
      unresolvedTaskFiles
        .map(
          (summary) =>
            `${summary.path} still has ${summary.uncheckedCount} unchecked checklist item(s).`,
        )
        .join(" "),
    );
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
      unresolvedTaskFiles.length > 0
        ? [
            "Finish or intentionally rewrite the remaining task-list items in:",
            unresolvedTaskFiles
              .map((summary) => {
                const preview = summary.uncheckedItems.slice(0, 3).join("; ");
                return preview ? `${summary.path} (${preview})` : `${summary.path}`;
              })
              .join(", "),
            ".",
          ].join(" ")
        : "",
      noWorkspaceChanges ? "If the task is not already satisfied, make concrete workspace changes." : "",
    ]
      .filter(Boolean)
      .join(" "),
    source: "heuristic",
  };
}

function parseAuditJson(rawOutput: string): AuditDecision {
  const parsed = JSON.parse(rawOutput) as Record<string, unknown>;
  const payload =
    typeof parsed.structured_output === "object" &&
    parsed.structured_output !== null &&
    !Array.isArray(parsed.structured_output)
      ? (parsed.structured_output as Record<string, unknown>)
      : parsed;
  const decision = payload.decision;
  const summary = payload.summary;
  const nextPrompt = payload.nextPrompt;

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
