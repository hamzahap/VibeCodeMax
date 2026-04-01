import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runExternalAuditor } from "../src/auditor.js";
import type { AuditPacket, NormalizedAgentProfile } from "../src/types.js";

test("runExternalAuditor accepts structured_output wrapped JSON", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-audit-"));
  const attemptDirectory = path.join(workspace, "attempt-001");
  await writeFile(
    path.join(workspace, "fake-auditor.mjs"),
    [
      'console.log(JSON.stringify({',
      '  type: "result",',
      '  structured_output: {',
      '    decision: "complete",',
      '    summary: "wrapped output accepted",',
      '    nextPrompt: ""',
      "  }",
      "}));",
    ].join("\n"),
    "utf8",
  );

  const agent: NormalizedAgentProfile = {
    type: "command",
    command: 'node ./fake-auditor.mjs',
    cwd: workspace,
    additionalWritableDirs: [],
    allowedTools: [],
    disallowedTools: [],
    extraArgs: [],
  };

  const packet: AuditPacket = {
    attempt: 1,
    task: {
      title: "test",
      objective: "test",
    },
    primaryResult: {
      command: "node fake",
      cwd: workspace,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    },
    verificationResults: [],
    workspaceSnapshot: {
      isGitRepo: false,
      changedFiles: [],
      statusLines: [],
      diffHash: "",
      summary: "none",
    },
    requiredFiles: [],
    budgets: {
      attemptsUsed: 1,
      elapsedMinutes: 0,
      estimatedUsd: 0,
      estimatedTokens: 0,
    },
  };

  const decision = await runExternalAuditor({
    config: {
      configPath: path.join(workspace, "config.json"),
      configDirectory: workspace,
      workspace,
      task: {
        title: "test",
        objective: "test",
        completionCriteria: [],
        contextFiles: [],
      },
      budgets: {
        mode: "bounded",
        maxAttempts: 1,
      },
      agents: {
        auditor: agent,
      },
      run: {
        primaryAgent: "auditor",
        auditorAgent: "auditor",
        verification: [],
        requiredFiles: [],
        artifactsDir: path.join(workspace, ".vibecodemax", "runs"),
        maxNoChangeAttempts: 1,
      },
    },
    agent,
    attempt: 1,
    attemptDirectory,
    packet,
    variables: {
      ATTEMPT: "1",
      ROLE: "auditor",
      WORKSPACE: workspace,
      RUN_DIR: workspace,
      PROMPT_FILE: path.join(attemptDirectory, "audit-prompt.md"),
      AUDIT_PACKET_FILE: path.join(attemptDirectory, "audit-packet.json"),
      MODEL: "",
      TASK_TITLE: "test",
      OBJECTIVE: "test",
      CONFIG_FILE: path.join(workspace, "config.json"),
    },
  });

  assert.equal(decision.decision, "complete");
  assert.equal(decision.summary, "wrapped output accepted");

  await rm(workspace, { recursive: true, force: true });
});
