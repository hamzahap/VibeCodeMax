export type BudgetMode = "bounded" | "until_complete";
export type AuditDecisionType = "complete" | "continue";
export type RunStatus = "completed" | "budget_exhausted" | "stopped";

export interface TaskConfig {
  title: string;
  objective: string;
  completionCriteria?: string[];
  contextFiles?: string[];
}

export interface NormalizedTaskConfig {
  title: string;
  objective: string;
  completionCriteria: string[];
  contextFiles: string[];
}

export interface BudgetConfig {
  mode?: BudgetMode;
  maxAttempts?: number;
  maxRuntimeMinutes?: number;
  maxUsd?: number;
  maxTokens?: number;
}

export interface AgentProfile {
  command: string;
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
  estimatedCostUsdPerRun?: number;
  estimatedTokensPerRun?: number;
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
  cwd: string;
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
