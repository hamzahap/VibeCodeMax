import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareAgentInvocation } from "../src/agents.js";
import type { NormalizedAgentProfile } from "../src/types.js";

async function createPromptFile(): Promise<{ directory: string; promptFile: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vcm-agent-"));
  const promptFile = path.join(directory, "prompt.md");
  await writeFile(promptFile, "# Prompt\n\nFinish the task.\n", "utf8");
  return { directory, promptFile };
}

test("prepareAgentInvocation builds a codex exec invocation with schema output capture", async () => {
  const { directory, promptFile } = await createPromptFile();

  const agent: NormalizedAgentProfile = {
    type: "codex_exec",
    cwd: directory,
    model: "gpt-5.4",
    dangerouslyBypassApprovalsAndSandbox: true,
    additionalWritableDirs: [],
    allowedTools: [],
    disallowedTools: [],
    extraArgs: [],
    jsonSchema: {
      type: "object",
      properties: {
        decision: { type: "string" },
        nextPrompt: { type: "string" },
      },
      required: ["decision"],
    },
  };

  const invocation = await prepareAgentInvocation({
    agent,
    role: "auditor",
    variables: {
      ATTEMPT: "1",
      ROLE: "auditor",
      WORKSPACE: directory,
      RUN_DIR: directory,
      PROMPT_FILE: promptFile,
      AUDIT_PACKET_FILE: path.join(directory, "audit-packet.json"),
      MODEL: "gpt-5.4",
      TASK_TITLE: "Test task",
      OBJECTIVE: "Finish the task",
      CONFIG_FILE: path.join(directory, "config.json"),
    },
  });

  assert.equal(invocation.executable, "codex");
  assert.deepEqual(invocation.args?.slice(0, 5), ["exec", "-C", directory, "--color", "never"]);
  assert.ok(invocation.args?.includes("--output-schema"));
  assert.ok(invocation.args?.includes("--output-last-message"));
  assert.equal(invocation.args?.at(-1), "-");
  assert.match(invocation.captureStdoutFile ?? "", /auditor-last-message\.txt$/);
  assert.match(invocation.stdin ?? "", /Finish the task/);

  const schemaArgIndex = invocation.args?.indexOf("--output-schema") ?? -1;
  assert.ok(schemaArgIndex >= 0);
  const schemaFile = invocation.args?.[schemaArgIndex + 1];
  assert.ok(schemaFile);
  assert.match(await readFile(schemaFile, "utf8"), /decision/);
  assert.match(await readFile(schemaFile, "utf8"), /"required": \[/);
  assert.match(await readFile(schemaFile, "utf8"), /nextPrompt/);

  await rm(directory, { recursive: true, force: true });
});

test("prepareAgentInvocation builds a claude print invocation with JSON schema", async () => {
  const { directory, promptFile } = await createPromptFile();

  const agent: NormalizedAgentProfile = {
    type: "claude_print",
    cwd: directory,
    model: "sonnet",
    permissionMode: "auto",
    dangerouslySkipPermissions: true,
    noSessionPersistence: true,
    outputFormat: "json",
    additionalWritableDirs: [directory],
    allowedTools: ["Bash"],
    disallowedTools: ["Edit"],
    extraArgs: ["--verbose"],
    jsonSchema: {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
    },
  };

  const invocation = await prepareAgentInvocation({
    agent,
    role: "auditor",
    variables: {
      ATTEMPT: "1",
      ROLE: "auditor",
      WORKSPACE: directory,
      RUN_DIR: directory,
      PROMPT_FILE: promptFile,
      AUDIT_PACKET_FILE: path.join(directory, "audit-packet.json"),
      MODEL: "sonnet",
      TASK_TITLE: "Test task",
      OBJECTIVE: "Finish the task",
      CONFIG_FILE: path.join(directory, "config.json"),
    },
  });

  assert.equal(invocation.executable, "claude");
  assert.deepEqual(invocation.args?.slice(0, 3), ["-p", "--output-format", "json"]);
  assert.ok(invocation.args?.includes("--json-schema"));
  assert.ok(invocation.args?.includes("--dangerously-skip-permissions"));
  assert.ok(invocation.args?.includes("--no-session-persistence"));
  assert.ok(invocation.args?.includes("--verbose"));
  assert.match(invocation.args?.at(-1) ?? "", /Finish the task/);

  await rm(directory, { recursive: true, force: true });
});
