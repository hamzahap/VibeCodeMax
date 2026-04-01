import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { CommandInvocation, CommandResult } from "./types.js";

interface RunCommandOptions {
  cwd: string;
  env?: Record<string, string>;
}

function renderCommandLabel(input: CommandInvocation): string {
  if (input.shellCommand) {
    return input.shellCommand;
  }

  const executable = input.executable ?? "";
  const args = input.args ?? [];
  return [executable, ...args.map((arg) => (/\s/u.test(arg) ? JSON.stringify(arg) : arg))]
    .filter(Boolean)
    .join(" ");
}

async function maybeReadFile(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) {
    return undefined;
  }

  try {
    await access(filePath);
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

export async function ensureDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(1)}s`;
  }

  return `${(durationMs / 60_000).toFixed(1)}m`;
}

export async function runShellCommand(
  command: string,
  options: RunCommandOptions,
): Promise<CommandResult> {
  return runCommand({
    cwd: options.cwd,
    env: options.env,
    shellCommand: command,
  });
}

export async function runCommand(input: CommandInvocation): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = input.shellCommand
      ? spawn(input.shellCommand, {
          cwd: input.cwd,
          env: {
            ...process.env,
            ...input.env,
          },
          shell: true,
          stdio: ["pipe", "pipe", "pipe"],
        })
      : spawn(input.executable ?? "", input.args ?? [], {
          cwd: input.cwd,
          env: {
            ...process.env,
            ...input.env,
          },
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });

    const commandLabel = renderCommandLabel(input);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    if (input.stdin !== undefined) {
      child.stdin.write(input.stdin);
    }

    child.stdin.end();

    child.on("close", async (exitCode) => {
      const capturedStdout = await maybeReadFile(input.captureStdoutFile);
      resolve({
        command: commandLabel,
        cwd: input.cwd,
        exitCode: exitCode ?? 1,
        stdout: capturedStdout ?? stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        processStdout: capturedStdout !== undefined ? stdout : undefined,
        capturedStdoutFile: capturedStdout !== undefined ? input.captureStdoutFile : undefined,
      });
    });
  });
}

