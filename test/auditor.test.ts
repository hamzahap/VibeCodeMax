import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildAuditPacket, runExternalAuditor, runHeuristicAudit } from "../src/auditor.js";
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
        taskFiles: [],
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

test("runExternalAuditor writes taskScope into the audit packet file", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-audit-"));
  const attemptDirectory = path.join(workspace, "attempt-001");
  await writeFile(
    path.join(workspace, "fake-auditor.mjs"),
    'console.log(JSON.stringify({ decision: "complete", summary: "scope present", nextPrompt: "" }));',
    "utf8",
  );
  await writeFile(path.join(workspace, "scope.md"), "# Scope\n", "utf8");

  const agent: NormalizedAgentProfile = {
    type: "command",
    command: "node ./fake-auditor.mjs",
    cwd: workspace,
    additionalWritableDirs: [],
    allowedTools: [],
    disallowedTools: [],
    extraArgs: [],
  };

  const config = {
    configPath: path.join(workspace, "config.json"),
    configDirectory: workspace,
    workspace,
    task: {
      title: "test",
      objective: "test",
      completionCriteria: [],
      contextFiles: [],
      scopeFile: "scope.md",
      taskFiles: [],
    },
    budgets: {
      mode: "bounded" as const,
      maxAttempts: 1,
    },
    agents: {
      auditor: agent,
    },
    run: {
      primaryAgent: "auditor",
      auditorAgent: "auditor",
      verification: [],
      requiredFiles: ["scope.md"],
      artifactsDir: path.join(workspace, ".vibecodemax", "runs"),
      maxNoChangeAttempts: 1,
    },
  };

  const packet = await buildAuditPacket({
    config,
    attempt: 1,
    taskScope: {
      path: "scope.md",
      content: "# Scope\n",
      truncated: false,
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
    attemptsUsed: 1,
    elapsedMinutes: 0,
    estimatedUsd: 0,
    estimatedTokens: 0,
  });

  await runExternalAuditor({
    config,
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

  const writtenPacket = JSON.parse(
    await readFile(path.join(attemptDirectory, "audit-packet.json"), "utf8"),
  ) as AuditPacket;
  assert.equal(writtenPacket.taskScope?.path, "scope.md");
  assert.equal(writtenPacket.taskScope?.content, "# Scope\n");
  assert.equal(writtenPacket.task.scopeFile, "scope.md");

  await rm(workspace, { recursive: true, force: true });
});

test("runHeuristicAudit blocks completion when task files still have unchecked checklist items", async () => {
  const packet: AuditPacket = {
    attempt: 1,
    task: {
      title: "task checklist",
      objective: "finish all tasks",
      taskFiles: ["TASKS.md"],
    },
    taskFiles: [
      {
        path: "TASKS.md",
        content: "# Tasks\n\n- [x] Ship backend\n- [ ] Update docs\n",
        truncated: false,
      },
    ],
    primaryResult: {
      command: "node fake",
      cwd: process.cwd(),
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    },
    verificationResults: [],
    workspaceSnapshot: {
      isGitRepo: true,
      changedFiles: ["TASKS.md"],
      statusLines: [" M TASKS.md"],
      diffHash: "abc",
      summary: "1 changed file(s): TASKS.md",
    },
    requiredFiles: [],
    budgets: {
      attemptsUsed: 1,
      elapsedMinutes: 0,
      estimatedUsd: 0,
      estimatedTokens: 0,
    },
  };

  const decision = await runHeuristicAudit(packet);

  assert.equal(decision.decision, "continue");
  assert.match(decision.summary, /TASKS\.md still has 1 unchecked checklist item/);
  assert.match(decision.nextPrompt ?? "", /Update docs/);
});
