import { createHash } from "node:crypto";
import path from "node:path";
import { runShellCommand } from "./process.js";
import type { WorkspaceSnapshot } from "./types.js";

function normalizeRelativePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function parseStatusLine(line: string): string {
  const content = line.length >= 3 ? line.slice(3).trim() : line.trim();
  const renameMarker = " -> ";

  if (content.includes(renameMarker)) {
    const pieces = content.split(renameMarker);
    return normalizeRelativePath(pieces.at(-1) ?? content);
  }

  return normalizeRelativePath(content);
}

function buildIgnorePrefixes(workspace: string, ignorePaths: string[]): string[] {
  return ignorePaths
    .map((entry) => path.relative(workspace, entry))
    .map(normalizeRelativePath)
    .filter(Boolean);
}

export async function collectWorkspaceSnapshot(
  workspace: string,
  ignorePaths: string[],
): Promise<WorkspaceSnapshot> {
  const rootCheck = await runShellCommand("git rev-parse --is-inside-work-tree", { cwd: workspace });

  if (rootCheck.exitCode !== 0 || !rootCheck.stdout.includes("true")) {
    return {
      isGitRepo: false,
      changedFiles: [],
      statusLines: [],
      diffHash: "",
      summary: "Workspace is not a git repository.",
    };
  }

  const rootResult = await runShellCommand("git rev-parse --show-toplevel", { cwd: workspace });
  const gitRoot = rootResult.stdout.trim() || workspace;
  const scopeFromRoot = normalizeRelativePath(path.relative(gitRoot, workspace)) || ".";
  const quotedRoot = `"${gitRoot}"`;
  const quotedScope = `"${scopeFromRoot}"`;

  const statusResult = await runShellCommand(
    `git -C ${quotedRoot} status --short --untracked-files=all -- ${quotedScope}`,
    {
      cwd: workspace,
    },
  );

  const ignorePrefixes = buildIgnorePrefixes(workspace, ignorePaths);
  const statusLines = statusResult.stdout
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const gitRelative = parseStatusLine(line);
      const workspaceRelative = normalizeRelativePath(
        path.relative(workspace, path.resolve(gitRoot, gitRelative)),
      );
      return workspaceRelative.startsWith("..")
        ? ""
        : workspaceRelative
        ? `${line.slice(0, 3)}${workspaceRelative}`
        : line;
    })
    .filter(Boolean)
    .filter((line) => {
      const relative = parseStatusLine(line);
      return !ignorePrefixes.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
    });

  const changedFiles = statusLines.map(parseStatusLine);
  const diffHash = createHash("sha256").update(statusLines.join("\n"), "utf8").digest("hex");
  const summary =
    changedFiles.length === 0
      ? "No git changes detected outside ignored paths."
      : `${changedFiles.length} changed file(s): ${changedFiles.join(", ")}`;

  return {
    isGitRepo: true,
    changedFiles,
    statusLines,
    diffHash,
    summary,
  };
}
