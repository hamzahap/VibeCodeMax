#!/usr/bin/env node
import path from "node:path";
import { runFromConfig } from "./orchestrator.js";
import { formatRunSummary, loadRunSummary, resolveRunSummaryPath } from "./runs.js";

function printHelp(): void {
  console.log(`VibeCodeMax

Usage:
  vibecodemax run [config-file]
  vibecodemax inspect [latest|run-directory|run-summary.json]

Examples:
  vibecodemax run
  vibecodemax run .\\examples\\basic.config.json
  vibecodemax inspect latest
`);
}

async function main(): Promise<void> {
  const [, , command = "run", configArg] = process.argv;

  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  if (command === "inspect") {
    const summaryPath = await resolveRunSummaryPath(configArg, process.cwd());
    const summary = await loadRunSummary(summaryPath);
    console.log(formatRunSummary(summary));
    return;
  }

  if (command !== "run") {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const configPath = path.resolve(configArg ?? "vibecodemax.config.json");
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
