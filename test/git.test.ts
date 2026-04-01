import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectWorkspaceSnapshot } from "../src/git.js";
import { runShellCommand } from "../src/process.js";

async function createTempRepo(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-git-"));
  await runShellCommand("git init", { cwd: workspace });
  await runShellCommand('git config user.email "test@example.com"', { cwd: workspace });
  await runShellCommand('git config user.name "Test User"', { cwd: workspace });
  await writeFile(path.join(workspace, "README.md"), "hello\n", "utf8");
  await runShellCommand("git add README.md", { cwd: workspace });
  await runShellCommand('git commit -m "init"', { cwd: workspace });
  return workspace;
}

test("collectWorkspaceSnapshot preserves modified file names", async () => {
  const workspace = await createTempRepo();
  await writeFile(path.join(workspace, "README.md"), "updated\n", "utf8");

  const snapshot = await collectWorkspaceSnapshot(workspace, []);

  assert.equal(snapshot.isGitRepo, true);
  assert.ok(snapshot.changedFiles.includes("README.md"));
  assert.match(snapshot.summary, /README\.md/);

  await rm(workspace, { recursive: true, force: true });
});
