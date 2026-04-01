import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runShellCommand } from "../src/process.js";
import { runFromConfig } from "../src/orchestrator.js";

async function createTempRepo(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-"));
  await runShellCommand("git init", { cwd: workspace });
  await writeFile(path.join(workspace, ".gitignore"), ".vibecodemax/\n", "utf8");
  await runShellCommand('git config user.email "test@example.com"', { cwd: workspace });
  await runShellCommand('git config user.name "Test User"', { cwd: workspace });
  await runShellCommand("git add .", { cwd: workspace });
  await runShellCommand('git commit -m "init"', { cwd: workspace });
  return workspace;
}

test("runFromConfig retries until the auditor marks the run complete", async () => {
  const workspace = await createTempRepo();
  const configPath = path.join(workspace, "vibecodemax.config.json");
  const repoRoot = path.resolve(process.cwd());

  await writeFile(
    configPath,
    JSON.stringify(
      {
        workspace,
        task: {
          title: "Ship the deliverable",
          objective: "Create deliverable.txt and make it final.",
          completionCriteria: ["deliverable.txt exists and contains final text."],
        },
        budgets: {
          mode: "bounded",
          maxAttempts: 4,
        },
        agents: {
          primary: {
            command: `node "${path.join(repoRoot, "examples", "fake-agent.mjs")}"`,
          },
          auditor: {
            command: `node "${path.join(repoRoot, "examples", "fake-auditor.mjs")}"`,
          },
        },
        run: {
          primaryAgent: "primary",
          auditorAgent: "auditor",
          requiredFiles: ["deliverable.txt"],
          verification: [
            {
              name: "deliverable-check",
              command:
                "node -e \"const fs=require('fs'); const text=fs.readFileSync('deliverable.txt','utf8'); if(!text.includes('Final deliverable')) process.exit(1);\"",
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const messages: string[] = [];
  const summary = await runFromConfig(configPath, {
    info(message) {
      messages.push(message);
    },
  });

  assert.equal(summary.status, "completed");
  assert.equal(summary.attempts, 2);
  assert.match(await readFile(path.join(workspace, "deliverable.txt"), "utf8"), /Final deliverable/);
  assert.ok(messages.some((message) => message.includes("Attempt 1")));
  assert.ok(messages.some((message) => message.includes("Audit: complete")));

  await rm(workspace, { recursive: true, force: true });
});

test("runFromConfig stops after bounded attempts are exhausted", async () => {
  const workspace = await createTempRepo();
  const configPath = path.join(workspace, "vibecodemax.config.json");

  await writeFile(
    path.join(workspace, "stuck-agent.mjs"),
    [
      'import fs from "node:fs/promises";',
      'import path from "node:path";',
      'const workspace = process.env.VCM_WORKSPACE;',
      'await fs.writeFile(path.join(workspace, "attempt.txt"), "still stuck\\n", "utf8");',
      'console.log("stuck");',
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    configPath,
    JSON.stringify(
      {
        workspace,
        task: {
          title: "Stuck run",
          objective: "This should never complete.",
        },
        budgets: {
          mode: "bounded",
          maxAttempts: 2,
        },
        agents: {
          primary: {
            command: 'node ./stuck-agent.mjs',
          },
        },
        run: {
          primaryAgent: "primary",
          requiredFiles: ["never.txt"],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const summary = await runFromConfig(configPath, {
    info() {},
  });

  assert.equal(summary.status, "budget_exhausted");
  assert.equal(summary.attempts, 2);

  await rm(workspace, { recursive: true, force: true });
});

test("runFromConfig does not trigger the no-change guard outside git repositories", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "vcm-no-git-"));
  const configPath = path.join(workspace, "vibecodemax.config.json");

  await writeFile(
    configPath,
    JSON.stringify(
      {
        workspace,
        task: {
          title: "Non-git workspace",
          objective: "Keep trying until the bounded budget is exhausted.",
        },
        budgets: {
          mode: "bounded",
          maxAttempts: 2,
        },
        agents: {
          primary: {
            command:
              'node -e "const fs=require(\'fs\'); fs.writeFileSync(\'attempt.txt\', \'still trying\\n\');"',
          },
        },
        run: {
          primaryAgent: "primary",
          requiredFiles: ["missing.txt"],
          maxNoChangeAttempts: 1,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const summary = await runFromConfig(configPath, {
    info() {},
  });

  assert.equal(summary.status, "budget_exhausted");
  assert.equal(summary.attempts, 2);

  await rm(workspace, { recursive: true, force: true });
});

test("runFromConfig honors explicit budgets in until_complete mode", async () => {
  const workspace = await createTempRepo();
  const configPath = path.join(workspace, "vibecodemax.config.json");

  await writeFile(
    path.join(workspace, "stuck-agent.mjs"),
    [
      'import fs from "node:fs/promises";',
      'import path from "node:path";',
      'const workspace = process.env.VCM_WORKSPACE;',
      'await fs.writeFile(path.join(workspace, "attempt.txt"), "still stuck\\n", "utf8");',
      'console.log("stuck");',
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    configPath,
    JSON.stringify(
      {
        workspace,
        task: {
          title: "Until complete with cap",
          objective: "This should stop when the explicit attempt budget is reached.",
        },
        budgets: {
          mode: "until_complete",
          maxAttempts: 2,
        },
        agents: {
          primary: {
            command: "node ./stuck-agent.mjs",
          },
        },
        run: {
          primaryAgent: "primary",
          requiredFiles: ["never.txt"],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const summary = await runFromConfig(configPath, {
    info() {},
  });

  assert.equal(summary.status, "budget_exhausted");
  assert.equal(summary.attempts, 2);

  await rm(workspace, { recursive: true, force: true });
});
