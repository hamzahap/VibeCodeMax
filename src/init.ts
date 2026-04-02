import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "./process.js";
import type { RawConfig, VerificationCommandConfig } from "./types.js";

export type InitAgentPreset = "codex" | "claude";
type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const CONFIG_FILENAME = "vibecodemax.config.json";
const SCOPE_FILENAME = "vibecodemax.scope.md";

interface PackageJsonShape {
  name?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
}

export interface InitProjectOptions {
  targetDir?: string;
  agentPreset?: InitAgentPreset;
  force?: boolean;
}

export interface InitProjectResult {
  workspace: string;
  configPath: string;
  scopePath: string;
  agentPreset: InitAgentPreset;
  packageManager?: PackageManager;
  contextFiles: string[];
  taskFiles: string[];
  requiredFiles: string[];
  verification: VerificationCommandConfig[];
  gitignoreUpdated: boolean;
  overwritten: boolean;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

async function loadPackageJson(workspace: string): Promise<PackageJsonShape | undefined> {
  const packageJsonPath = path.join(workspace, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return undefined;
  }

  const contents = await readFile(packageJsonPath, "utf8");
  return JSON.parse(contents) as PackageJsonShape;
}

async function detectPackageManager(
  workspace: string,
  packageJson: PackageJsonShape | undefined,
): Promise<PackageManager | undefined> {
  const configured = packageJson?.packageManager?.split("@")[0];
  if (configured === "npm" || configured === "pnpm" || configured === "yarn" || configured === "bun") {
    return configured;
  }

  if (await pathExists(path.join(workspace, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (
    (await pathExists(path.join(workspace, "bun.lockb"))) ||
    (await pathExists(path.join(workspace, "bun.lock")))
  ) {
    return "bun";
  }

  if (await pathExists(path.join(workspace, "yarn.lock"))) {
    return "yarn";
  }

  if (await pathExists(path.join(workspace, "package-lock.json"))) {
    return "npm";
  }

  if (packageJson) {
    return "npm";
  }

  return undefined;
}

function isRealTestScript(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false;
  }

  return !/no test specified/i.test(value);
}

function buildScriptCommand(packageManager: PackageManager, scriptName: string): string {
  switch (packageManager) {
    case "npm":
      return scriptName === "test" ? "npm test" : `npm run ${scriptName}`;
    case "pnpm":
      return scriptName === "test" ? "pnpm test" : `pnpm ${scriptName}`;
    case "yarn":
      return scriptName === "test" ? "yarn test" : `yarn ${scriptName}`;
    case "bun":
      return `bun run ${scriptName}`;
    default:
      return `npm run ${scriptName}`;
  }
}

function buildPackageJsonVerification(
  packageManager: PackageManager,
  packageJson: PackageJsonShape,
): VerificationCommandConfig[] {
  const scripts = packageJson.scripts ?? {};
  const verification: VerificationCommandConfig[] = [];
  const scriptOrder = ["test", "lint", "typecheck", "build"];

  for (const scriptName of scriptOrder) {
    const script = scripts[scriptName];
    if (!script?.trim()) {
      continue;
    }

    if (scriptName === "test" && !isRealTestScript(script)) {
      continue;
    }

    verification.push({
      name: scriptName,
      command: buildScriptCommand(packageManager, scriptName),
    });
  }

  return verification;
}

async function detectVerificationCommands(
  workspace: string,
  packageManager: PackageManager | undefined,
  packageJson: PackageJsonShape | undefined,
): Promise<VerificationCommandConfig[]> {
  if (packageManager && packageJson) {
    const verification = buildPackageJsonVerification(packageManager, packageJson);
    if (verification.length > 0) {
      return verification;
    }
  }

  if (await pathExists(path.join(workspace, "Cargo.toml"))) {
    return [{ name: "cargo-test", command: "cargo test" }];
  }

  if (await pathExists(path.join(workspace, "go.mod"))) {
    return [{ name: "go-test", command: "go test ./..." }];
  }

  if (
    (await pathExists(path.join(workspace, "pyproject.toml"))) ||
    (await pathExists(path.join(workspace, "pytest.ini"))) ||
    (await pathExists(path.join(workspace, "tox.ini"))) ||
    (await pathExists(path.join(workspace, "setup.cfg")))
  ) {
    return [{ name: "pytest", command: "pytest" }];
  }

  return [];
}

async function detectReadme(workspace: string): Promise<string | undefined> {
  const candidates = ["README.md", "README.mdx", "README.txt", "README"];

  for (const candidate of candidates) {
    if (await pathExists(path.join(workspace, candidate))) {
      return candidate;
    }
  }

  return undefined;
}

async function detectContextFiles(workspace: string): Promise<string[]> {
  const candidates = [
    "README.md",
    "README.mdx",
    "README.txt",
    "README",
    "package.json",
    "tsconfig.json",
    "pnpm-workspace.yaml",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
  ];

  const discovered: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(path.join(workspace, candidate))) {
      discovered.push(candidate);
    }
  }

  return uniqueStrings(discovered);
}

async function detectTaskFiles(workspace: string): Promise<string[]> {
  const candidates = [
    "TASKS.md",
    "TASKLIST.md",
    "TODO.md",
    "PLAN.md",
    "CHECKLIST.md",
    "docs/TASKS.md",
    "docs/TODO.md",
    "docs/PLAN.md",
    ".claude/TASKS.md",
    ".claude/TODO.md",
    ".codex/TASKS.md",
    ".codex/TODO.md",
  ];

  const discovered: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(path.join(workspace, candidate))) {
      discovered.push(candidate);
    }
  }

  return uniqueStrings(discovered);
}

function buildScopeTemplate(input: {
  repoName: string;
  scopeFile: string;
  verification: VerificationCommandConfig[];
  contextFiles: string[];
  taskFiles: string[];
}): string {
  const verificationLines =
    input.verification.length === 0
      ? [
          "- No verification commands were auto-detected.",
          "- Add repo-specific checks to vibecodemax.config.json before you rely on autonomous completion.",
        ]
      : input.verification.map((command) => `- ${command.command}`);

  const contextLines =
    input.contextFiles.length === 0
      ? ["- No obvious context files were auto-detected."]
      : input.contextFiles.map((file) => `- ${file}`);

  const taskFileLines =
    input.taskFiles.length === 0
      ? ["- No conventional task-list files were auto-detected."]
      : input.taskFiles.map((file) => `- ${file}`);

  return [
    "# VibeCodeMax Scope",
    "",
    `This file defines what "complete" means for ${input.repoName}.`,
    "Edit it before the first serious autonomous run.",
    "",
    "## Requested Outcome",
    "- Describe the exact task you want the agent to finish.",
    "- Link or name any issue, PR, or feature branch if that matters.",
    "",
    "## Definition of Done",
    "- Replace these bullets with concrete acceptance criteria.",
    "- Keep code, tests, and docs aligned with the requested outcome.",
    "- If the repo already satisfies this scope, avoid unnecessary churn.",
    "",
    "## Auto-Detected Verification",
    ...verificationLines,
    "",
    "## Useful Context",
    ...contextLines,
    "",
    "## Auto-Detected Task Lists",
    ...taskFileLines,
    "",
    "## Notes",
    `- VibeCodeMax reads this file through task.scopeFile in ${CONFIG_FILENAME}.`,
    `- VibeCodeMax reads task/task-list files through task.taskFiles in ${CONFIG_FILENAME}.`,
    "- Tighten this file whenever you raise the bar for what counts as complete.",
  ].join("\n");
}

function buildAgentConfig(agentPreset: InitAgentPreset): RawConfig["agents"] {
  if (agentPreset === "claude") {
    return {
      primary: {
        type: "claude_print",
        model: "sonnet",
        permissionMode: "auto",
        dangerouslySkipPermissions: true,
        noSessionPersistence: true,
      },
      auditor: {
        type: "claude_print",
        model: "sonnet",
        permissionMode: "auto",
        dangerouslySkipPermissions: true,
        noSessionPersistence: true,
        outputFormat: "json",
        jsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            decision: {
              type: "string",
              enum: ["complete", "continue"],
            },
            summary: {
              type: "string",
            },
            nextPrompt: {
              type: "string",
            },
          },
          required: ["decision", "summary", "nextPrompt"],
        },
      },
    };
  }

  return {
    primary: {
      type: "codex_exec",
      model: "gpt-5.4",
      dangerouslyBypassApprovalsAndSandbox: true,
    },
    auditor: {
      type: "codex_exec",
      model: "gpt-5.4-mini",
      dangerouslyBypassApprovalsAndSandbox: true,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          decision: {
            type: "string",
            enum: ["complete", "continue"],
          },
          summary: {
            type: "string",
          },
          nextPrompt: {
            type: "string",
          },
        },
        required: ["decision", "summary", "nextPrompt"],
      },
    },
  };
}

async function updateGitignore(workspace: string): Promise<boolean> {
  const gitignorePath = path.join(workspace, ".gitignore");
  const artifactEntry = ".vibecodemax/";

  if (!(await pathExists(gitignorePath))) {
    await writeFile(gitignorePath, `${artifactEntry}\n`, "utf8");
    return true;
  }

  const existing = await readFile(gitignorePath, "utf8");
  if (
    existing
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .includes(artifactEntry)
  ) {
    return false;
  }

  const separator = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
  await writeFile(gitignorePath, `${existing}${separator}${artifactEntry}\n`, "utf8");
  return true;
}

export async function initProject(options: InitProjectOptions = {}): Promise<InitProjectResult> {
  const workspace = path.resolve(options.targetDir ?? process.cwd());
  const agentPreset = options.agentPreset ?? "codex";
  const force = options.force ?? false;

  await mkdir(workspace, { recursive: true });

  const packageJson = await loadPackageJson(workspace);
  const packageManager = await detectPackageManager(workspace, packageJson);
  const verification = await detectVerificationCommands(workspace, packageManager, packageJson);
  const contextFiles = await detectContextFiles(workspace);
  const taskFiles = await detectTaskFiles(workspace);
  const readme = await detectReadme(workspace);
  const repoName = packageJson?.name?.trim() || path.basename(workspace);
  const configPath = path.join(workspace, CONFIG_FILENAME);
  const scopePath = path.join(workspace, SCOPE_FILENAME);
  const scopeFile = SCOPE_FILENAME;
  const requiredFiles = uniqueStrings([scopeFile, ...(readme ? [readme] : [])]);

  const config: RawConfig = {
    workspace: ".",
    task: {
      title: `Complete work for ${repoName}`,
      objective: `Complete the requested work for ${repoName} according to ${scopeFile}. If the repository already satisfies the scope, avoid unnecessary churn and leave the workspace passing verification.`,
      scopeFile,
      completionCriteria: [
        `Everything in ${scopeFile} is satisfied.`,
        verification.length > 0
          ? "All configured verification commands pass."
          : "Add verification commands before you rely on this run for completion.",
        taskFiles.length > 0
          ? "Configured task tracking files are either fully completed or intentionally updated to reflect the true finished scope."
          : "If the repo uses a task list, add it under task.taskFiles so unchecked items count against completion.",
      ],
      contextFiles,
      taskFiles,
    },
    budgets: {
      mode: "until_complete",
      maxRuntimeMinutes: 60,
    },
    agents: buildAgentConfig(agentPreset),
    run: {
      primaryAgent: "primary",
      auditorAgent: "auditor",
      requiredFiles,
      verification,
      maxNoChangeAttempts: 2,
    },
  };

  const scopeContents = buildScopeTemplate({
    repoName,
    scopeFile,
    verification,
    contextFiles,
    taskFiles,
  });

  const existingConfig = await pathExists(configPath);
  const existingScope = await pathExists(scopePath);
  if (!force && (existingConfig || existingScope)) {
    const conflicts = [existingConfig ? CONFIG_FILENAME : undefined, existingScope ? SCOPE_FILENAME : undefined]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Refusing to overwrite existing files: ${conflicts}. Re-run with --force to replace them.`);
  }

  await writeJson(configPath, config);
  await writeFile(scopePath, `${scopeContents}\n`, "utf8");
  const gitignoreUpdated = await updateGitignore(workspace);

  return {
    workspace,
    configPath,
    scopePath,
    agentPreset,
    packageManager,
    contextFiles,
    taskFiles,
    requiredFiles,
    verification,
    gitignoreUpdated,
    overwritten: existingConfig || existingScope,
  };
}
