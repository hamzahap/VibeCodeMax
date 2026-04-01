import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { renderTemplate, type TemplateVariables } from "./prompts.js";
import { ensureDirectory, runCommand, writeJson } from "./process.js";
import type {
  CommandInvocation,
  CommandResult,
  NormalizedAgentProfile,
} from "./types.js";

export type AgentRole = "primary" | "auditor";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCodexJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties;

  if (!isRecord(properties)) {
    return schema;
  }

  return {
    ...schema,
    required: Object.keys(properties),
  };
}

function buildRuntimeEnv(
  variables: TemplateVariables,
  role: AgentRole,
  extraEnv: Record<string, string>,
): Record<string, string> {
  return {
    ...extraEnv,
    VCM_ATTEMPT: variables.ATTEMPT,
    VCM_ROLE: role,
    VCM_WORKSPACE: variables.WORKSPACE,
    VCM_RUN_DIR: variables.RUN_DIR,
    VCM_PROMPT_FILE: variables.PROMPT_FILE,
    VCM_AUDIT_PACKET_FILE: variables.AUDIT_PACKET_FILE,
    VCM_MODEL: variables.MODEL,
    VCM_TASK_TITLE: variables.TASK_TITLE,
    VCM_OBJECTIVE: variables.OBJECTIVE,
    VCM_CONFIG_FILE: variables.CONFIG_FILE,
  };
}

function renderEnv(
  agent: NormalizedAgentProfile,
  variables: TemplateVariables,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(agent.env ?? {}).map(([key, value]) => [key, renderTemplate(value, variables)]),
  );
}

function renderArray(entries: string[], variables: TemplateVariables): string[] {
  return entries.map((entry) => renderTemplate(entry, variables));
}

async function buildCommandInvocation(input: {
  agent: NormalizedAgentProfile;
  variables: TemplateVariables;
  role: AgentRole;
}): Promise<CommandInvocation> {
  const { agent, variables, role } = input;
  const env = buildRuntimeEnv(variables, role, renderEnv(agent, variables));

  return {
    cwd: agent.cwd,
    env,
    shellCommand: renderTemplate(agent.command ?? "", variables),
  };
}

async function buildCodexInvocation(input: {
  agent: NormalizedAgentProfile;
  variables: TemplateVariables;
  role: AgentRole;
}): Promise<CommandInvocation> {
  const { agent, variables, role } = input;
  const env = buildRuntimeEnv(variables, role, renderEnv(agent, variables));
  const promptText = await readFile(variables.PROMPT_FILE, "utf8");
  const attemptDirectory = dirname(variables.PROMPT_FILE);
  const outputFile = join(attemptDirectory, `${role}-last-message.txt`);
  const args = ["exec", "-C", agent.cwd, "--color", agent.color ?? "never"];

  if (agent.model) {
    args.push("-m", renderTemplate(agent.model, variables));
  }

  if (agent.profile) {
    args.push("-p", renderTemplate(agent.profile, variables));
  }

  if (agent.fullAuto) {
    args.push("--full-auto");
  }

  if (agent.sandbox) {
    args.push("-s", agent.sandbox);
  }

  if (agent.dangerouslyBypassApprovalsAndSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }

  if (agent.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }

  for (const directory of agent.additionalWritableDirs) {
    args.push("--add-dir", renderTemplate(directory, variables));
  }

  if (agent.jsonSchema) {
    const schemaFile = join(attemptDirectory, `${role}-output-schema.json`);
    await ensureDirectory(attemptDirectory);
    await writeJson(schemaFile, normalizeCodexJsonSchema(agent.jsonSchema));
    args.push("--output-schema", schemaFile);
  }

  args.push("--output-last-message", outputFile);
  args.push(...renderArray(agent.extraArgs, variables));
  args.push("-");

  return {
    cwd: agent.cwd,
    env,
    executable: "codex",
    args,
    stdin: promptText,
    captureStdoutFile: outputFile,
  };
}

async function buildClaudeInvocation(input: {
  agent: NormalizedAgentProfile;
  variables: TemplateVariables;
  role: AgentRole;
}): Promise<CommandInvocation> {
  const { agent, variables, role } = input;
  const env = buildRuntimeEnv(variables, role, renderEnv(agent, variables));
  const promptText = await readFile(variables.PROMPT_FILE, "utf8");
  const outputFormat = agent.outputFormat ?? (agent.jsonSchema ? "json" : role === "auditor" ? "json" : "text");
  const args = ["-p", "--input-format", "text", "--output-format", outputFormat];

  if (agent.model) {
    args.push("--model", renderTemplate(agent.model, variables));
  }

  if (agent.permissionMode) {
    args.push("--permission-mode", agent.permissionMode);
  }

  if (agent.maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(agent.maxBudgetUsd));
  }

  if (agent.systemPrompt) {
    args.push("--system-prompt", renderTemplate(agent.systemPrompt, variables));
  }

  if (agent.appendSystemPrompt) {
    args.push("--append-system-prompt", renderTemplate(agent.appendSystemPrompt, variables));
  }

  if (agent.noSessionPersistence) {
    args.push("--no-session-persistence");
  }

  if (agent.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  for (const directory of agent.additionalWritableDirs) {
    args.push("--add-dir", renderTemplate(directory, variables));
  }

  if (agent.allowedTools.length > 0) {
    args.push("--allowedTools", agent.allowedTools.join(","));
  }

  if (agent.disallowedTools.length > 0) {
    args.push("--disallowedTools", agent.disallowedTools.join(","));
  }

  if (agent.jsonSchema) {
    args.push("--json-schema", JSON.stringify(agent.jsonSchema));
  }

  args.push(...renderArray(agent.extraArgs, variables));

  return {
    cwd: agent.cwd,
    env,
    executable: "claude",
    args,
    stdin: promptText,
  };
}

export async function prepareAgentInvocation(input: {
  agent: NormalizedAgentProfile;
  variables: TemplateVariables;
  role: AgentRole;
}): Promise<CommandInvocation> {
  switch (input.agent.type) {
    case "command":
      return buildCommandInvocation(input);
    case "codex_exec":
      return buildCodexInvocation(input);
    case "claude_print":
      return buildClaudeInvocation(input);
    default:
      throw new Error(`Unsupported agent type ${(input.agent as { type?: string }).type ?? "unknown"}.`);
  }
}

export async function runConfiguredAgent(input: {
  agent: NormalizedAgentProfile;
  variables: TemplateVariables;
  role: AgentRole;
}): Promise<CommandResult> {
  const invocation = await prepareAgentInvocation(input);
  return runCommand(invocation);
}
