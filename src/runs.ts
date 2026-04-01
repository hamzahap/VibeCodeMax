import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { RunSummary } from "./types.js";

function toLocalIso(input: string): string {
  return new Date(input).toISOString();
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(1)}s`;
  }

  if (durationMs < 3_600_000) {
    return `${(durationMs / 60_000).toFixed(1)}m`;
  }

  return `${(durationMs / 3_600_000).toFixed(1)}h`;
}

export async function loadRunSummary(summaryPath: string): Promise<RunSummary> {
  const contents = await readFile(summaryPath, "utf8");
  return JSON.parse(contents) as RunSummary;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveRunSummaryPath(target: string | undefined, cwd: string): Promise<string> {
  if (!target || target === "latest") {
    const runsDirectory = path.resolve(cwd, ".vibecodemax", "runs");
    const entries = await readdir(runsDirectory, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const summaryPath = path.join(runsDirectory, candidates[index]!, "run-summary.json");
      if (await pathExists(summaryPath)) {
        return summaryPath;
      }
    }

    if (candidates.length === 0) {
      throw new Error(`No runs found under ${runsDirectory}.`);
    }

    throw new Error(`No completed runs found under ${runsDirectory}.`);
  }

  const resolved = path.resolve(cwd, target);
  const summaryPath =
    path.basename(resolved).toLowerCase() === "run-summary.json"
      ? resolved
      : path.join(resolved, "run-summary.json");

  if (!(await pathExists(summaryPath))) {
    throw new Error(`Run summary not found at ${summaryPath}. The run may still be in progress.`);
  }

  return summaryPath;
}

export function formatRunSummary(summary: RunSummary): string {
  const lines: string[] = [];
  lines.push(`Run: ${summary.runDirectory}`);
  lines.push(`Status: ${summary.status}`);
  lines.push(`Reason: ${summary.reason}`);
  lines.push(`Workspace: ${summary.workspace}`);
  lines.push(`Attempts: ${summary.attempts}`);
  lines.push(`Started: ${toLocalIso(summary.startedAt)}`);
  lines.push(`Finished: ${toLocalIso(summary.finishedAt)}`);
  lines.push(`Duration: ${formatDuration(summary.totalDurationMs)}`);
  lines.push(`Estimated Tokens: ${summary.totalEstimatedTokens}`);
  lines.push(`Estimated USD: ${summary.totalEstimatedUsd}`);
  lines.push("");
  lines.push("Attempts:");

  for (const record of summary.records) {
    const passedVerification = record.verificationResults.filter((result) => result.exitCode === 0).length;
    const failedVerification = record.verificationResults.length - passedVerification;
    lines.push(
      `- #${record.attempt} primary exit ${record.primaryResult.exitCode} in ${formatDuration(record.primaryResult.durationMs)} | verification ${passedVerification} passed, ${failedVerification} failed | audit ${record.auditDecision.decision}`,
    );
    lines.push(`  Prompt: ${record.promptFile}`);
    lines.push(`  Workspace: ${record.workspaceSnapshot.summary}`);
    lines.push(`  Audit: ${record.auditDecision.summary}`);
  }

  return `${lines.join("\n")}\n`;
}
