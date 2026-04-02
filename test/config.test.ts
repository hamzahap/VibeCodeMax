import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";

test("self-host configs load with native Codex and Claude adapters", async () => {
  const repoRoot = path.resolve(process.cwd());

  const codexConfig = await loadConfig(path.join(repoRoot, "vibecodemax.self-host.codex.json"));
  assert.equal(codexConfig.agents.primary!.type, "codex_exec");
  assert.equal(codexConfig.agents.auditor!.type, "codex_exec");
  assert.equal(codexConfig.task.scopeFile, "docs/current-scope.md");
  assert.match(codexConfig.task.objective, /do not start nested `npm run self-host:\*`/i);
  assert.ok(
    codexConfig.task.completionCriteria.includes(
      "The final state is verifiable through this completed self-host run.",
    ),
  );
  assert.deepEqual(codexConfig.agents.auditor?.jsonSchema?.required, [
    "decision",
    "summary",
    "nextPrompt",
  ]);
  assert.ok(
    codexConfig.run.verification.some((command) => command.command === "cmd /c npm test"),
  );

  const claudeConfig = await loadConfig(path.join(repoRoot, "vibecodemax.self-host.claude.json"));
  assert.equal(claudeConfig.agents.primary!.type, "claude_print");
  assert.equal(claudeConfig.agents.auditor!.type, "claude_print");
  assert.equal(claudeConfig.task.scopeFile, "docs/current-scope.md");
  assert.match(claudeConfig.task.objective, /do not start nested `npm run self-host:\*`/i);
  assert.ok(
    claudeConfig.task.completionCriteria.includes(
      "The final state is verifiable through this completed self-host run.",
    ),
  );
  assert.deepEqual(claudeConfig.agents.auditor?.jsonSchema?.required, [
    "decision",
    "summary",
    "nextPrompt",
  ]);
  assert.ok(
    claudeConfig.run.verification.some((command) => command.command === "cmd /c npm test"),
  );
});

test("loadConfig rejects blank task.scopeFile", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-config-"));
  const configPath = path.join(workspace, "vibecodemax.config.json");

  await writeFile(
    configPath,
    JSON.stringify(
      {
        workspace,
        task: {
          title: "Invalid scope",
          objective: "Validate task.scopeFile.",
          scopeFile: "   ",
        },
        agents: {
          primary: {
            command: "echo hi",
          },
        },
        run: {
          primaryAgent: "primary",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await assert.rejects(loadConfig(configPath), /task.scopeFile must be a non-empty string/);

  await rm(workspace, { recursive: true, force: true });
});

test("loadConfig rejects blank task.taskFiles entries", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-config-"));
  const configPath = path.join(workspace, "vibecodemax.config.json");

  await writeFile(
    configPath,
    JSON.stringify(
      {
        workspace,
        task: {
          title: "Invalid task files",
          objective: "Validate task.taskFiles.",
          taskFiles: ["TASKS.md", "   "],
        },
        agents: {
          primary: {
            command: "echo hi",
          },
        },
        run: {
          primaryAgent: "primary",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await assert.rejects(loadConfig(configPath), /task.taskFiles must be an array of non-empty strings/);

  await rm(workspace, { recursive: true, force: true });
});

test("loadConfig rejects unsupported codex_exec approvalPolicy and search fields", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-config-"));
  const configPath = path.join(workspace, "vibecodemax.config.json");

  await writeFile(
    configPath,
    JSON.stringify(
      {
        workspace,
        task: {
          title: "Invalid codex flags",
          objective: "Validate codex_exec fields.",
        },
        agents: {
          primary: {
            type: "codex_exec",
            approvalPolicy: "never",
            search: true,
          },
        },
        run: {
          primaryAgent: "primary",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await assert.rejects(
    loadConfig(configPath),
    /approvalPolicy is not supported for codex_exec/,
  );

  await writeFile(
    configPath,
    JSON.stringify(
      {
        workspace,
        task: {
          title: "Invalid codex search",
          objective: "Validate codex_exec fields.",
        },
        agents: {
          primary: {
            type: "codex_exec",
            search: true,
          },
        },
        run: {
          primaryAgent: "primary",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await assert.rejects(loadConfig(configPath), /search is not supported for codex_exec/);

  await rm(workspace, { recursive: true, force: true });
});
