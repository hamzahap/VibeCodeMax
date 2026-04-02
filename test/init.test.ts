import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initProject } from "../src/init.js";
import type { RawConfig } from "../src/types.js";

test("initProject scaffolds a codex config for a Node repo", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-init-"));

  await writeFile(
    path.join(workspace, "package.json"),
    JSON.stringify(
      {
        name: "example-app",
        packageManager: "pnpm@10.0.0",
        scripts: {
          test: "vitest run",
          lint: "eslint .",
          build: "tsc -p tsconfig.json",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(path.join(workspace, "README.md"), "# Example App\n", "utf8");
  await writeFile(path.join(workspace, "tsconfig.json"), "{ }\n", "utf8");
  await writeFile(path.join(workspace, "TASKS.md"), "# Tasks\n\n- [ ] Ship feature\n", "utf8");

  const result = await initProject({ targetDir: workspace });
  const config = JSON.parse(
    await readFile(path.join(workspace, "vibecodemax.config.json"), "utf8"),
  ) as RawConfig;
  const scope = await readFile(path.join(workspace, "vibecodemax.scope.md"), "utf8");
  const gitignore = await readFile(path.join(workspace, ".gitignore"), "utf8");

  assert.equal(result.agentPreset, "codex");
  assert.equal(result.packageManager, "pnpm");
  assert.equal(config.task.scopeFile, "vibecodemax.scope.md");
  assert.deepEqual(config.task.taskFiles, ["TASKS.md"]);
  assert.equal(config.agents.primary?.type, "codex_exec");
  assert.deepEqual(
    config.run.verification?.map((command) => command.command),
    ["pnpm test", "pnpm lint", "pnpm build"],
  );
  assert.deepEqual(config.run.requiredFiles, ["vibecodemax.scope.md", "README.md"]);
  assert.ok(config.task.contextFiles?.includes("README.md"));
  assert.ok(config.task.contextFiles?.includes("package.json"));
  assert.deepEqual(result.taskFiles, ["TASKS.md"]);
  assert.match(scope, /This file defines what "complete" means for example-app\./);
  assert.match(scope, /pnpm test/);
  assert.match(scope, /Auto-Detected Task Lists/);
  assert.match(scope, /TASKS\.md/);
  assert.match(gitignore, /\.vibecodemax\//);

  await rm(workspace, { recursive: true, force: true });
});

test("initProject refuses overwrites unless force is set and supports the Claude preset", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-init-"));

  await writeFile(path.join(workspace, "vibecodemax.config.json"), "{}\n", "utf8");

  await assert.rejects(
    initProject({ targetDir: workspace, agentPreset: "claude" }),
    /Refusing to overwrite existing files: vibecodemax.config.json/,
  );

  const result = await initProject({
    targetDir: workspace,
    agentPreset: "claude",
    force: true,
  });
  const config = JSON.parse(
    await readFile(path.join(workspace, "vibecodemax.config.json"), "utf8"),
  ) as RawConfig;

  assert.equal(result.agentPreset, "claude");
  assert.equal(result.overwritten, true);
  assert.equal(config.agents.primary?.type, "claude_print");
  assert.equal(config.agents.auditor?.type, "claude_print");

  await rm(workspace, { recursive: true, force: true });
});

test("initProject detects a Rust repo when package.json is absent", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-init-"));

  await writeFile(
    path.join(workspace, "Cargo.toml"),
    '[package]\nname = "rust-app"\nversion = "0.1.0"\n',
    "utf8",
  );

  const result = await initProject({ targetDir: workspace });
  const config = JSON.parse(
    await readFile(path.join(workspace, "vibecodemax.config.json"), "utf8"),
  ) as RawConfig;

  assert.equal(result.packageManager, undefined);
  assert.deepEqual(config.run.verification?.map((command) => command.command), ["cargo test"]);
  assert.ok(config.task.contextFiles?.includes("Cargo.toml"));

  await rm(workspace, { recursive: true, force: true });
});
