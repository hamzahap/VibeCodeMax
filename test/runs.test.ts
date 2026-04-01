import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatRunSummary, resolveRunSummaryPath } from "../src/runs.js";
import type { RunSummary } from "../src/types.js";

test("resolveRunSummaryPath picks the latest completed run directory", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-runs-"));
  const runsDirectory = path.join(workspace, ".vibecodemax", "runs");
  const older = path.join(runsDirectory, "2026-04-01T10-00-00Z-old");
  const newer = path.join(runsDirectory, "2026-04-01T11-00-00Z-new");
  const newestIncomplete = path.join(runsDirectory, "2026-04-01T12-00-00Z-in-progress");

  await mkdir(older, { recursive: true });
  await mkdir(newer, { recursive: true });
  await mkdir(newestIncomplete, { recursive: true });
  await writeFile(path.join(older, "run-summary.json"), "{}\n", "utf8");
  await writeFile(path.join(newer, "run-summary.json"), "{}\n", "utf8");

  const resolved = await resolveRunSummaryPath("latest", workspace);
  assert.equal(resolved, path.join(newer, "run-summary.json"));

  await rm(workspace, { recursive: true, force: true });
});

test("formatRunSummary renders a readable attempt timeline", () => {
  const summary: RunSummary = {
    status: "completed",
    reason: "Everything passed.",
    startedAt: "2026-04-01T10:00:00.000Z",
    finishedAt: "2026-04-01T10:05:00.000Z",
    attempts: 1,
    totalDurationMs: 300_000,
    totalEstimatedUsd: 0,
    totalEstimatedTokens: 1234,
    runDirectory: "D:\\Runs\\example",
    workspace: "D:\\Repo",
    lastAudit: {
      decision: "complete",
      summary: "Everything passed.",
      source: "external",
    },
    records: [
      {
        attempt: 1,
        startedAt: "2026-04-01T10:00:00.000Z",
        promptFile: "D:\\Runs\\example\\attempt-001\\primary-prompt.md",
        primaryResult: {
          command: "codex exec -",
          cwd: "D:\\Repo",
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 120_000,
        },
        verificationResults: [
          {
            name: "npm-test",
            continueOnFailure: false,
            command: "cmd /c npm test",
            cwd: "D:\\Repo",
            exitCode: 0,
            stdout: "",
            stderr: "",
            durationMs: 5_000,
          },
        ],
        workspaceSnapshot: {
          isGitRepo: true,
          changedFiles: ["README.md"],
          statusLines: [" M README.md"],
          diffHash: "abc",
          summary: "1 changed file(s): README.md",
        },
        auditDecision: {
          decision: "complete",
          summary: "Everything passed.",
          source: "external",
        },
      },
    ],
  };

  const rendered = formatRunSummary(summary);
  assert.match(rendered, /Status: completed/);
  assert.match(rendered, /Attempts:/);
  assert.match(rendered, /#1 primary exit 0/);
  assert.match(rendered, /Workspace: 1 changed file\(s\): README.md/);
  assert.match(rendered, /Audit: Everything passed\./);
});

test("resolveRunSummaryPath reports an in-progress target clearly", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-runs-"));
  const runDirectory = path.join(workspace, ".vibecodemax", "runs", "2026-04-01T12-00-00Z-in-progress");

  await mkdir(runDirectory, { recursive: true });

  await assert.rejects(
    () => resolveRunSummaryPath(runDirectory, workspace),
    /Run summary not found .* may still be in progress\./,
  );

  await rm(workspace, { recursive: true, force: true });
});
