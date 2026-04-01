#!/usr/bin/env node
import path from "node:path";
import { initProject, type InitAgentPreset } from "./init.js";
import { runFromConfig } from "./orchestrator.js";
import { formatRunSummary, loadRunSummary, resolveRunSummaryPath } from "./runs.js";

function printHelp(): void {
  console.log(`VibeCodeMax

Usage:
  vibecodemax init [target-directory] [--agent codex|claude] [--force]
  vibecodemax run [config-file]
  vibecodemax inspect [latest|run-directory|run-summary.json]

Examples:
  vibecodemax init
  vibecodemax init ..\\another-repo --agent claude
  vibecodemax run
  vibecodemax run .\\examples\\basic.config.json
  vibecodemax inspect latest
`);
}

function formatInitSummary(input: Awaited<ReturnType<typeof initProject>>): string {
  const lines = [
    `Initialized VibeCodeMax in ${input.workspace}`,
    `Config: ${input.configPath}`,
    `Scope: ${input.scopePath}`,
    `Agent preset: ${input.agentPreset}`,
    `Package manager: ${input.packageManager ?? "not detected"}`,
    `Verification: ${input.verification.length > 0 ? input.verification.map((command) => command.command).join(", ") : "none auto-detected"}`,
    `Context files: ${input.contextFiles.length > 0 ? input.contextFiles.join(", ") : "none auto-detected"}`,
    `Required files: ${input.requiredFiles.join(", ")}`,
    `Gitignore updated: ${input.gitignoreUpdated ? "yes" : "no"}`,
    "",
    "Next steps:",
    `1. Edit ${path.basename(input.scopePath)} to define the task and done criteria.`,
    `2. Review ${path.basename(input.configPath)} and tighten verification if needed.`,
    `3. Run vibecodemax run ${path.basename(input.configPath)}.`,
  ];

  return `${lines.join("\n")}\n`;
}

function parseInitArgs(args: string[]): {
  targetDir?: string;
  agentPreset?: InitAgentPreset;
  force?: boolean;
} {
  let targetDir: string | undefined;
  let agentPreset: InitAgentPreset | undefined;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }

    if (argument === "--force") {
      force = true;
      continue;
    }

    if (argument === "--agent") {
      const value = args[index + 1];
      if (value !== "codex" && value !== "claude") {
        throw new Error(`Unsupported --agent value "${value ?? ""}". Use codex or claude.`);
      }

      agentPreset = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown option ${argument}.`);
    }

    if (targetDir !== undefined) {
      throw new Error("Only one target directory may be provided to init.");
    }

    targetDir = argument;
  }

  return {
    targetDir,
    agentPreset,
    force,
  };
}

async function main(): Promise<void> {
  const [, , command = "run", ...args] = process.argv;

  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  if (command === "init") {
    const result = await initProject(parseInitArgs(args));
    console.log(formatInitSummary(result));
    return;
  }

  if (command === "inspect") {
    const summaryPath = await resolveRunSummaryPath(args[0], process.cwd());
    const summary = await loadRunSummary(summaryPath);
    console.log(formatRunSummary(summary));
    return;
  }

  if (command !== "run") {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const configPath = path.resolve(args[0] ?? "vibecodemax.config.json");
  const summary = await runFromConfig(configPath, {
    info(message) {
      console.log(message);
    },
  });

  console.log("");
  console.log(`Status: ${summary.status}`);
  console.log(`Reason: ${summary.reason}`);
  console.log(`Attempts: ${summary.attempts}`);
  console.log(`Artifacts: ${summary.runDirectory}`);

  if (summary.status !== "completed") {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
