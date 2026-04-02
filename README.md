# VibeCodeMax

VibeCodeMax is a local orchestrator for coding agents that stop too early.

It wraps a primary agent in an audit loop, runs verification commands after every attempt, and keeps reprompting until the task is actually done or a budget limit is hit. The goal is simple: stop waking up to a half-finished result.

## What It Does

- Runs any scriptable coding agent through a config file.
- Ships native adapters for `codex exec` and `claude -p`.
- Supports a separate auditor agent or a built-in heuristic auditor.
- Re-prompts automatically using the last failed audit.
- Enforces budgets by attempts, runtime, estimated USD, or estimated tokens.
- Stores every prompt, result, verification log, and audit packet under `.vibecodemax/runs/...`.
- Works best with CLI-driven tools today and can be adapted to GUI/editor tools through wrappers.

## Current Scope

The current repo-owned definition of done lives in [`docs/current-scope.md`](docs/current-scope.md).

That file is the contract the self-host loop should satisfy. If you want to raise or change what "100% complete" means, update that file first, then rerun self-host against the new scope.

This repo currently ships a strong CLI-first release. It is strongest when your agent can be launched non-interactively from a shell command. GUI tools and editor extensions can still participate, but only if you expose them through a wrapper script or task that can consume a prompt file and return control to the orchestrator.

## Quick Start

```bash
npm install
npm run build
node dist/src/cli.js init
node dist/src/cli.js run vibecodemax.config.json
node dist/src/cli.js inspect latest
```

To bootstrap another repository from this checkout:

```bash
cd /path/to/other-repo
node /path/to/VibeCodeMax/dist/src/cli.js init . --agent codex
node /path/to/VibeCodeMax/dist/src/cli.js run vibecodemax.config.json
node /path/to/VibeCodeMax/dist/src/cli.js inspect latest
```

The generated bootstrap creates:

- `vibecodemax.config.json`
- `vibecodemax.scope.md`
- a `.gitignore` entry for `.vibecodemax/`

It also auto-detects conventional task trackers such as `TASKS.md`, `TODO.md`, `PLAN.md`, and `CHECKLIST.md` including common `.claude/` and `.codex/` locations, then wires them into `task.taskFiles`.

If you just want to test the loop end-to-end before wiring in a real repo:

```bash
node dist/src/cli.js run examples/basic.config.json
node dist/src/cli.js inspect latest
```

The demo config uses a fake primary agent and a fake auditor so you can verify the loop end-to-end before wiring in a real model.

For native self-hosting on this repo:

```bash
npm run self-host:codex
npm run self-host:claude
node dist/src/cli.js inspect .vibecodemax/runs/<run-directory>
```

The included self-host configs point at [`docs/current-scope.md`](docs/current-scope.md) through `task.scopeFile`, so the run is judged against an explicit scope document instead of an implicit chat goal.
The outer self-host run is the proof run. Do not trigger `npm run self-host:*` or `node dist/src/cli.js run ...` recursively from inside the primary agent unless you are explicitly testing nested orchestration.

## How It Works

1. VibeCodeMax loads a JSON config.
2. It writes a primary prompt file for the current attempt.
3. It runs your configured primary agent.
4. It runs verification commands against the workspace.
5. It snapshots git-visible workspace changes.
6. It asks the configured auditor whether the task is complete.
7. If the answer is `continue`, it builds the next prompt from the audit feedback and repeats.
8. You can inspect the final run timeline with `vibecodemax inspect`.

## Bootstrapping Another Repo

Use `init` from the target repository root:

```bash
vibecodemax init
```

Or point it at another workspace explicitly:

```bash
vibecodemax init ../another-repo --agent claude
```

What `init` does:

- detects common repo files and package managers
- generates `vibecodemax.config.json`
- generates `vibecodemax.scope.md`
- detects conventional task-list files such as `TASKS.md`, `TODO.md`, `PLAN.md`, and `CHECKLIST.md`
- auto-fills verification commands for common setups such as npm, pnpm, yarn, bun, Cargo, Go, and pytest-style Python repos
- appends `.vibecodemax/` to `.gitignore`

Before the first real run, edit `vibecodemax.scope.md` so the task and definition of done are explicit.
If the repo already has a real task list, leave it in place and let VibeCodeMax read it through `task.taskFiles`.

## Inspecting Runs

Use the CLI to inspect the latest completed run or a specific completed run directory:

```bash
node dist/src/cli.js inspect latest
node dist/src/cli.js inspect .vibecodemax/runs/2026-04-01T15-24-00-640Z-self-host-vibecodemax-with-codex
```

`inspect latest` skips newer in-progress run directories and resolves to the newest run that already has a `run-summary.json`.

The output summarizes:

- overall status, reason, attempts, duration, and estimated usage
- each attempt's primary-agent exit code and duration
- verification pass/fail counts
- workspace change summary
- auditor decision for each attempt

## Releases

Public GitHub Releases are free, so this repo now ships a tag-driven release flow.

- Pushing a tag like `v0.1.0` triggers [`.github/workflows/release.yml`](.github/workflows/release.yml).
- The workflow runs `npm test`, builds the CLI, creates an `npm pack` tarball, generates `SHA256SUMS.txt`, and publishes both to a GitHub Release.
- That gives you a downloadable packaged CLI artifact directly from GitHub without paying for npm publishing.

Public npm packages and public GitHub Packages are also free, but actually publishing to those registries still requires account credentials or tokens. This repo does not auto-publish to a registry yet.

## Config Shape

```json
{
  "workspace": ".",
  "task": {
    "title": "Complete work for my-repo",
    "objective": "Complete the requested work for my-repo according to vibecodemax.scope.md. If the repository already satisfies the scope, avoid unnecessary churn and leave the workspace passing verification.",
    "scopeFile": "vibecodemax.scope.md",
    "taskFiles": ["TASKS.md"],
    "completionCriteria": [
      "Everything in vibecodemax.scope.md is satisfied.",
      "All configured verification commands pass.",
      "Configured task tracking files are either fully completed or intentionally updated to reflect the true finished scope."
    ],
    "contextFiles": ["README.md", "package.json", "tsconfig.json"]
  },
  "budgets": {
    "mode": "until_complete",
    "maxRuntimeMinutes": 60
  },
  "agents": {
    "primary": {
      "type": "codex_exec",
      "model": "gpt-5.4",
      "dangerouslyBypassApprovalsAndSandbox": true
    },
    "auditor": {
      "type": "codex_exec",
      "model": "gpt-5.4-mini",
      "dangerouslyBypassApprovalsAndSandbox": true
    }
  },
  "run": {
    "primaryAgent": "primary",
    "auditorAgent": "auditor",
    "requiredFiles": ["vibecodemax.scope.md", "README.md"],
    "verification": [
      {
        "name": "test",
        "command": "npm test"
      }
    ],
    "maxNoChangeAttempts": 2
  }
}
```

## Budgets

- `mode: "bounded"`: stop when a configured limit is reached. If you omit `maxAttempts`, the default is `10`.
- `mode: "until_complete"`: keep going until the auditor marks it complete, unless another budget like `maxUsd` or `maxRuntimeMinutes` is also set.

## Updating Scope

To change what "100% complete" means for a run:

1. Edit the scope document referenced by `task.scopeFile`.
2. Tighten `run.verification` or `run.requiredFiles` if the new scope needs stronger proof.
3. If you have not bootstrapped the repo yet, run `node dist/src/cli.js init`.
4. Rerun the loop with `node dist/src/cli.js run <config>` or one of the included self-host scripts.
5. Inspect the finished run with `node dist/src/cli.js inspect latest`.

For this repository, the default scope file is [`docs/current-scope.md`](docs/current-scope.md).

## Task Tracking Files

Use `task.taskFiles` for repo-local checklists such as `TASKS.md`.

- These files are rendered in a dedicated prompt section for the primary agent.
- They are included in the audit packet for the external auditor.
- The built-in heuristic auditor treats unchecked markdown checkboxes as incomplete work.
- If a task file is stale, the agent should either finish the remaining items or intentionally update the file so it matches the true completed scope.

## Integrating Your Agent

Each agent profile can be either:

- `type: "command"` with a raw shell `command`.
- `type: "codex_exec"` for native Codex CLI execution.
- `type: "claude_print"` for native Claude Code CLI execution.

If `type` is omitted, VibeCodeMax treats the agent as `command`.

### Native Adapters

`codex_exec` uses `codex exec` under the hood and sends the prompt through stdin. It supports fields such as:

- `model`
- `sandbox`
- `fullAuto`
- `dangerouslyBypassApprovalsAndSandbox`
- `skipGitRepoCheck`
- `profile`
- `color`
- `additionalWritableDirs`
- `jsonSchema`
- `extraArgs`

Notes for Codex:

- `approvalPolicy` is not exposed by the current `codex exec` CLI. Use `fullAuto`, `sandbox`, or `dangerouslyBypassApprovalsAndSandbox` instead.
- `search` is not currently supported by `codex exec`.
- When `jsonSchema` is provided for Codex, VibeCodeMax normalizes it to the stricter response-schema format expected by the current `codex exec` CLI.

`claude_print` uses `claude -p` under the hood. It supports fields such as:

- `model`
- `permissionMode`
- `dangerouslySkipPermissions`
- `noSessionPersistence`
- `maxBudgetUsd`
- `systemPrompt`
- `appendSystemPrompt`
- `allowedTools`
- `disallowedTools`
- `jsonSchema`
- `extraArgs`

### Custom Commands

For `type: "command"`, VibeCodeMax renders your shell command and environment variables before launch.

Two ways to pass context into your tool:

- Template variables inside `command` or `env` values:
  - `${PROMPT_FILE}`
  - `${AUDIT_PACKET_FILE}`
  - `${WORKSPACE}`
  - `${RUN_DIR}`
  - `${ATTEMPT}`
  - `${MODEL}`
  - `${TASK_TITLE}`
  - `${OBJECTIVE}`
  - `${CONFIG_FILE}`
- Environment variables exposed automatically at runtime:
  - `VCM_PROMPT_FILE`
  - `VCM_AUDIT_PACKET_FILE`
  - `VCM_WORKSPACE`
  - `VCM_RUN_DIR`
  - `VCM_ATTEMPT`
  - `VCM_MODEL`
  - `VCM_TASK_TITLE`
  - `VCM_OBJECTIVE`
  - `VCM_CONFIG_FILE`

Wrapper templates are included under `examples/wrappers/`.

## Self-Hosting

Two self-host configs are included at the repo root:

- `vibecodemax.self-host.codex.json`
- `vibecodemax.self-host.claude.json`

They target this repository, run `npm test` as verification, and keep an external auditor in the loop for completion decisions.

A run is only marked complete when the auditor returns `complete`. Other stop conditions such as budgets or `maxNoChangeAttempts` end the run as incomplete.

The included self-host configs use `mode: "until_complete"` with a runtime cap, so they will keep retrying until the auditor can justify completion or a safety limit is reached.
They are intended to be launched once from outside the loop; the resulting outer run is the artifact you inspect as proof of completion.

When you use the built-in heuristic auditor instead of an external auditor, VibeCodeMax can still mark a clean no-op run complete if required files exist and verification already passes. It does not force artificial workspace churn just to satisfy the loop.

### Native Self-Host Examples

Codex primary + Codex auditor:

```json
{
  "agents": {
    "primary": {
      "type": "codex_exec",
      "model": "gpt-5.4",
      "dangerouslyBypassApprovalsAndSandbox": true
    },
    "auditor": {
      "type": "codex_exec",
      "model": "gpt-5.4-mini",
      "dangerouslyBypassApprovalsAndSandbox": true,
      "jsonSchema": {
        "type": "object",
        "properties": {
          "decision": { "type": "string", "enum": ["complete", "continue"] },
          "summary": { "type": "string" },
          "nextPrompt": { "type": "string" }
        },
        "required": ["decision", "summary", "nextPrompt"]
      }
    }
  },
  "run": {
    "primaryAgent": "primary",
    "auditorAgent": "auditor",
    "verification": [
      { "name": "tests", "command": "cmd /c npm test" }
    ]
  }
}
```

Claude primary + Claude auditor:

```json
{
  "agents": {
    "primary": {
      "type": "claude_print",
      "model": "sonnet",
      "permissionMode": "auto",
      "dangerouslySkipPermissions": true,
      "noSessionPersistence": true
    },
    "auditor": {
      "type": "claude_print",
      "model": "sonnet",
      "permissionMode": "auto",
      "dangerouslySkipPermissions": true,
      "noSessionPersistence": true,
      "outputFormat": "json",
      "jsonSchema": {
        "type": "object",
        "properties": {
          "decision": { "type": "string", "enum": ["complete", "continue"] },
          "summary": { "type": "string" },
          "nextPrompt": { "type": "string" }
        },
        "required": ["decision", "summary", "nextPrompt"]
      }
    }
  },
  "run": {
    "primaryAgent": "primary",
    "auditorAgent": "auditor",
    "verification": [
      { "name": "tests", "command": "cmd /c npm test" }
    ]
  }
}
```

## Claude Code / Codex / VS Code / GUI Notes

- Codex CLI works natively through `type: "codex_exec"`.
- Claude Code works natively through `type: "claude_print"`.
- If your tool already has a non-interactive CLI, point `command` at it directly.
- If your tool is GUI-first, create a local wrapper that reads `VCM_PROMPT_FILE`, launches the tool against `VCM_WORKSPACE`, waits for completion, and then exits.
- Native auditors should return JSON matching the required shape. For custom command auditors, stdout must be:

```json
{
  "decision": "complete",
  "summary": "Why the task is done"
}
```

Or:

```json
{
  "decision": "continue",
  "summary": "Why it is not done",
  "nextPrompt": "What the next attempt should fix"
}
```

## Demo Files

- `examples/basic.config.json`: self-contained demo config.
- `examples/fake-agent.mjs`: fake primary agent used by the demo.
- `examples/fake-auditor.mjs`: fake auditor used by the demo.
- `docs/current-scope.md`: repo-owned definition of done for the included self-host runs.
- `vibecodemax.self-host.codex.json`: self-host config for Codex CLI.
- `vibecodemax.self-host.claude.json`: self-host config for Claude Code CLI.
- `examples/wrappers/run-primary-agent-template.ps1`: Windows wrapper template for a real primary agent.
- `examples/wrappers/run-auditor-template.ps1`: Windows wrapper template for a real auditor.

## Development

```bash
npm install
npm run build
npm test
npm run package:dry-run
```

## Roadmap

- Interactive local dashboard for live runs.
- Better diff scoring and completion detection.
- Session resume and pause controls.
- Per-agent spend tracking from real API usage instead of estimates.

