import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildPrimaryPrompt, loadScopeSnippet } from "../src/prompts.js";
import type { NormalizedConfig } from "../src/types.js";

test("buildPrimaryPrompt includes the configured scope file and anti-recursion guidance", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-prompts-"));
  const scopeDirectory = path.join(workspace, "docs");
  await mkdir(scopeDirectory, { recursive: true });
  await writeFile(
    path.join(scopeDirectory, "scope.md"),
    "# Scope\n\n- Ship the feature fully.\n",
    "utf8",
  );

  const config: NormalizedConfig = {
    configPath: path.join(workspace, "vibecodemax.config.json"),
    configDirectory: workspace,
    workspace,
    task: {
      title: "Prompt scope test",
      objective: "Use the scope file in the prompt.",
      completionCriteria: ["Everything in docs/scope.md is satisfied."],
      contextFiles: [],
      scopeFile: "docs/scope.md",
    },
    budgets: {
      mode: "bounded",
      maxAttempts: 1,
    },
    agents: {},
    run: {
      primaryAgent: "primary",
      verification: [],
      requiredFiles: [],
      artifactsDir: path.join(workspace, ".vibecodemax", "runs"),
      maxNoChangeAttempts: 1,
    },
  };

  const scopeSnippet = await loadScopeSnippet(config);
  const prompt = buildPrimaryPrompt({
    config,
    attempt: 1,
    scopeSnippet,
    contextSnippets: [],
  });

  assert.ok(scopeSnippet);
  assert.match(prompt, /## Scope \/ Definition of Done/);
  assert.match(prompt, /docs\/scope\.md|docs\\scope\.md/);
  assert.match(prompt, /Ship the feature fully\./);
  assert.match(prompt, /Do not launch nested VibeCodeMax\/self-host loops/);
  assert.match(prompt, /use this run's artifacts instead of spawning another orchestrator instance/i);

  await rm(workspace, { recursive: true, force: true });
});
