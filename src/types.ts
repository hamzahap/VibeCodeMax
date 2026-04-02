export type BudgetMode = "bounded" | "until_complete";
export type AuditDecisionType = "complete" | "continue";
export type RunStatus = "completed" | "budget_exhausted" | "stopped";
export type AgentType = "command" | "codex_exec" | "claude_print";

export interface TaskConfig {
  title: string;
  objective: string;
  completionCriteria?: string[];
  contextFiles?: string[];
  scopeFile?: string;
  taskFiles?: string[];
}

export interface NormalizedTaskConfig {
  title: string;
  objective: string;
  completionCriteria: string[];
  contextFiles: string[];
  scopeFile?: string;
  taskFiles: string[];
}

export interface BudgetConfig {
  mode?: BudgetMode;
  maxAttempts?: number;
  maxRuntimeMinutes?: number;
  maxUsd?: number;
  maxTokens?: number;
}

export interface AgentProfile {
  type?: AgentType;
  command?: string;
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
  estimatedCostUsdPerRun?: number;
  estimatedTokensPerRun?: number;
  approvalPolicy?: string;
  sandbox?: string;
  permissionMode?: string;
  outputFormat?: "text" | "json";
  fullAuto?: boolean;
  dangerouslyBypassApprovalsAndSandbox?: boolean;
  dangerouslySkipPermissions?: boolean;
  noSessionPersistence?: boolean;
  skipGitRepoCheck?: boolean;
  search?: boolean;
  profile?: string;
  color?: "always" | "never" | "auto";
  systemPrompt?: string;
  appendSystemPrompt?: string;
  additionalWritableDirs?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  extraArgs?: string[];
  maxBudgetUsd?: number;
  jsonSchema?: Record<string, unknown>;
}

export interface VerificationCommandConfig {
  name: string;
  command: string;
  cwd?: string;
  continueOnFailure?: boolean;
}

export interface RunConfig {
  primaryAgent: string;
  auditorAgent?: string;
  verification?: VerificationCommandConfig[];
  requiredFiles?: string[];
  artifactsDir?: string;
  maxNoChangeAttempts?: number;
}

export interface RawConfig {
  workspace?: string;
  task: TaskConfig;
  budgets?: BudgetConfig;
  agents: Record<string, AgentProfile>;
  run: RunConfig;
}

export interface NormalizedBudgetConfig {
  mode: BudgetMode;
  maxAttempts?: number;
  maxRuntimeMinutes?: number;
  maxUsd?: number;
  maxTokens?: number;
}

export interface NormalizedAgentProfile extends AgentProfile {
  type: AgentType;
  cwd: string;
  additionalWritableDirs: string[];
  allowedTools: string[];
  disallowedTools: string[];
  extraArgs: string[];
}

export interface NormalizedVerificationCommand extends VerificationCommandConfig {
  cwd: string;
}

export interface NormalizedConfig {
  configPath: string;
  configDirectory: string;
  workspace: string;
  task: NormalizedTaskConfig;
  budgets: NormalizedBudgetConfig;
  agents: Record<string, NormalizedAgentProfile>;
  run: {
    primaryAgent: string;
    auditorAgent?: string;
    verification: NormalizedVerificationCommand[];
    requiredFiles: string[];
    artifactsDir: string;
    maxNoChangeAttempts: number;
  };
}

export interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  processStdout?: string;
  capturedStdoutFile?: string;
}

export interface CommandInvocation {
  cwd: string;
  env?: Record<string, string>;
  shellCommand?: string;
  executable?: string;
  args?: string[];
  stdin?: string;
  captureStdoutFile?: string;
}

export interface VerificationResult extends CommandResult {
  name: string;
  continueOnFailure: boolean;
}

export interface WorkspaceSnapshot {
  isGitRepo: boolean;
  changedFiles: string[];
  statusLines: string[];
  diffHash: string;
  summary: string;
}

export interface AuditDecision {
  decision: AuditDecisionType;
  summary: string;
  nextPrompt?: string;
  rawOutput?: string;
  source: "heuristic" | "external" | "fallback";
}

export interface AttemptRecord {
  attempt: number;
  startedAt: string;
  promptFile: string;
  primaryResult: CommandResult;
  verificationResults: VerificationResult[];
  workspaceSnapshot: WorkspaceSnapshot;
  auditDecision: AuditDecision;
}

export interface RunSummary {
  status: RunStatus;
  reason: string;
  startedAt: string;
  finishedAt: string;
  attempts: number;
  totalDurationMs: number;
  totalEstimatedUsd: number;
  totalEstimatedTokens: number;
  runDirectory: string;
  workspace: string;
  lastAudit?: AuditDecision;
  records: AttemptRecord[];
}

export interface ContextSnippet {
  path: string;
  content: string;
  truncated: boolean;
}

export interface AuditPacket {
  attempt: number;
  task: TaskConfig;
  taskScope?: ContextSnippet;
  taskFiles?: ContextSnippet[];
  previousFeedback?: string;
  primaryResult: CommandResult;
  verificationResults: VerificationResult[];
  workspaceSnapshot: WorkspaceSnapshot;
  requiredFiles: Array<{
    path: string;
    exists: boolean;
  }>;
  budgets: {
    attemptsUsed: number;
    maxAttempts?: number;
    elapsedMinutes: number;
    maxRuntimeMinutes?: number;
    estimatedUsd: number;
    maxUsd?: number;
    estimatedTokens: number;
    maxTokens?: number;
  };
}
