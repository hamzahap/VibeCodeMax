import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentProfile,
  BudgetConfig,
  NormalizedAgentProfile,
  NormalizedBudgetConfig,
  NormalizedConfig,
  RawConfig,
  VerificationCommandConfig,
} from "./types.js";

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim());
}

function resolveFrom(base: string, maybeRelative?: string): string {
  if (!maybeRelative) {
    return base;
  }

  return path.isAbsolute(maybeRelative)
    ? path.normalize(maybeRelative)
    : path.resolve(base, maybeRelative);
}

function normalizeBudgetConfig(raw: BudgetConfig | undefined): NormalizedBudgetConfig {
  const mode = raw?.mode ?? "bounded";

  if (mode !== "bounded" && mode !== "until_complete") {
    throw new Error(`Unsupported budgets.mode "${String(mode)}".`);
  }

  const numericFields = [
    ["budgets.maxAttempts", raw?.maxAttempts],
    ["budgets.maxRuntimeMinutes", raw?.maxRuntimeMinutes],
    ["budgets.maxUsd", raw?.maxUsd],
    ["budgets.maxTokens", raw?.maxTokens],
  ] as const;

  for (const [fieldName, value] of numericFields) {
    if (value !== undefined && !isPositiveNumber(value)) {
      throw new Error(`${fieldName} must be a positive number when set.`);
    }
  }

  return {
    mode,
    maxAttempts: raw?.maxAttempts ?? (mode === "bounded" ? 10 : undefined),
    maxRuntimeMinutes: raw?.maxRuntimeMinutes,
    maxUsd: raw?.maxUsd,
    maxTokens: raw?.maxTokens,
  };
}

function normalizeAgentProfile(
  workspace: string,
  name: string,
  profile: AgentProfile,
): NormalizedAgentProfile {
  const type = profile.type ?? "command";
  assertCondition(
    type === "command" || type === "codex_exec" || type === "claude_print",
    `agents.${name}.type must be one of command, codex_exec, claude_print.`,
  );

  if (type === "command") {
    assertCondition(profile.command && profile.command.trim(), `agents.${name}.command is required.`);
  }

  if (
    profile.estimatedCostUsdPerRun !== undefined &&
    !isPositiveNumber(profile.estimatedCostUsdPerRun)
  ) {
    throw new Error(`agents.${name}.estimatedCostUsdPerRun must be a positive number.`);
  }

  if (
    profile.estimatedTokensPerRun !== undefined &&
    !isPositiveNumber(profile.estimatedTokensPerRun)
  ) {
    throw new Error(`agents.${name}.estimatedTokensPerRun must be a positive number.`);
  }

  if (profile.maxBudgetUsd !== undefined && !isPositiveNumber(profile.maxBudgetUsd)) {
    throw new Error(`agents.${name}.maxBudgetUsd must be a positive number.`);
  }

  if (profile.additionalWritableDirs !== undefined && !isStringArray(profile.additionalWritableDirs)) {
    throw new Error(`agents.${name}.additionalWritableDirs must be an array of non-empty strings.`);
  }

  if (profile.allowedTools !== undefined && !isStringArray(profile.allowedTools)) {
    throw new Error(`agents.${name}.allowedTools must be an array of non-empty strings.`);
  }

  if (profile.disallowedTools !== undefined && !isStringArray(profile.disallowedTools)) {
    throw new Error(`agents.${name}.disallowedTools must be an array of non-empty strings.`);
  }

  if (profile.extraArgs !== undefined && !isStringArray(profile.extraArgs)) {
    throw new Error(`agents.${name}.extraArgs must be an array of non-empty strings.`);
  }

  if (type === "codex_exec" && profile.approvalPolicy !== undefined) {
    throw new Error(
      `agents.${name}.approvalPolicy is not supported for codex_exec. Use fullAuto, sandbox, or dangerouslyBypassApprovalsAndSandbox instead.`,
    );
  }

  if (type === "codex_exec" && profile.search !== undefined) {
    throw new Error(
      `agents.${name}.search is not supported for codex_exec. The current codex exec CLI does not accept --search.`,
    );
  }

  return {
    ...profile,
    type,
    cwd: resolveFrom(workspace, profile.cwd),
    additionalWritableDirs: (profile.additionalWritableDirs ?? []).map((entry) =>
      resolveFrom(workspace, entry),
    ),
    allowedTools: profile.allowedTools ?? [],
    disallowedTools: profile.disallowedTools ?? [],
    extraArgs: profile.extraArgs ?? [],
  };
}

function normalizeVerificationCommand(
  workspace: string,
  command: VerificationCommandConfig,
  index: number,
): VerificationCommandConfig & { cwd: string } {
  assertCondition(command.name?.trim(), `run.verification[${index}].name is required.`);
  assertCondition(command.command?.trim(), `run.verification[${index}].command is required.`);

  return {
    ...command,
    cwd: resolveFrom(workspace, command.cwd),
  };
}

export async function loadConfig(configPathInput: string): Promise<NormalizedConfig> {
  const configPath = path.resolve(configPathInput);
  const configDirectory = path.dirname(configPath);
  const rawContents = await readFile(configPath, "utf8");
  const parsed = JSON.parse(rawContents) as unknown;

  assertCondition(isPlainObject(parsed), "Config root must be a JSON object.");
  const raw = parsed as unknown as RawConfig;

  assertCondition(isPlainObject(raw.task), "task is required.");
  assertCondition(raw.task.title?.trim(), "task.title is required.");
  assertCondition(raw.task.objective?.trim(), "task.objective is required.");

  assertCondition(isPlainObject(raw.agents), "agents is required.");
  const agentEntries = Object.entries(raw.agents);
  assertCondition(agentEntries.length > 0, "At least one agent profile is required.");

  assertCondition(isPlainObject(raw.run), "run is required.");
  assertCondition(raw.run.primaryAgent?.trim(), "run.primaryAgent is required.");

  const workspace = resolveFrom(configDirectory, raw.workspace ?? ".");
  const budgets = normalizeBudgetConfig(raw.budgets);

  const agents = Object.fromEntries(
    agentEntries.map(([name, profile]) => [name, normalizeAgentProfile(workspace, name, profile)]),
  );

  assertCondition(
    agents[raw.run.primaryAgent] !== undefined,
    `run.primaryAgent references unknown agent "${raw.run.primaryAgent}".`,
  );

  if (raw.run.auditorAgent) {
    assertCondition(
      agents[raw.run.auditorAgent] !== undefined,
      `run.auditorAgent references unknown agent "${raw.run.auditorAgent}".`,
    );
  }

  if (raw.task.completionCriteria !== undefined) {
    assertCondition(
      Array.isArray(raw.task.completionCriteria) &&
        raw.task.completionCriteria.every((item) => typeof item === "string" && item.trim()),
      "task.completionCriteria must be an array of non-empty strings.",
    );
  }

  if (raw.task.contextFiles !== undefined) {
    assertCondition(
      Array.isArray(raw.task.contextFiles) &&
        raw.task.contextFiles.every((item) => typeof item === "string" && item.trim()),
      "task.contextFiles must be an array of non-empty strings.",
    );
  }

  if (raw.task.scopeFile !== undefined) {
    assertCondition(
      typeof raw.task.scopeFile === "string" && raw.task.scopeFile.trim(),
      "task.scopeFile must be a non-empty string.",
    );
  }

  if (raw.task.taskFiles !== undefined) {
    assertCondition(
      Array.isArray(raw.task.taskFiles) &&
        raw.task.taskFiles.every((item) => typeof item === "string" && item.trim()),
      "task.taskFiles must be an array of non-empty strings.",
    );
  }

  const verification = (raw.run.verification ?? []).map((command, index) =>
    normalizeVerificationCommand(workspace, command, index),
  );

  const requiredFiles = raw.run.requiredFiles ?? [];
  assertCondition(
    Array.isArray(requiredFiles) &&
      requiredFiles.every((item) => typeof item === "string" && item.trim()),
    "run.requiredFiles must be an array of non-empty strings.",
  );

  const maxNoChangeAttempts = raw.run.maxNoChangeAttempts ?? 3;
  if (!Number.isInteger(maxNoChangeAttempts) || maxNoChangeAttempts < 1) {
    throw new Error("run.maxNoChangeAttempts must be an integer >= 1.");
  }

  const artifactsDir = resolveFrom(
    workspace,
    raw.run.artifactsDir ?? path.join(".vibecodemax", "runs"),
  );

  return {
    configPath,
    configDirectory,
    workspace,
    task: {
      title: raw.task.title.trim(),
      objective: raw.task.objective.trim(),
      completionCriteria: raw.task.completionCriteria ?? [],
      contextFiles: raw.task.contextFiles ?? [],
      scopeFile: raw.task.scopeFile?.trim() || undefined,
      taskFiles: raw.task.taskFiles ?? [],
    },
    budgets,
    agents,
    run: {
      primaryAgent: raw.run.primaryAgent,
      auditorAgent: raw.run.auditorAgent,
      verification,
      requiredFiles,
      artifactsDir,
      maxNoChangeAttempts,
    },
  };
}
