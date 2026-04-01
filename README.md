# VibeCodeMax

VibeCodeMax is a local orchestrator for coding agents that stop too early.

It wraps a primary agent in an audit loop, runs verification commands after every attempt, and keeps reprompting until the task is actually done or a budget limit is hit. The goal is simple: stop waking up to a half-finished result.

## What This MVP Does

- Runs any scriptable coding agent through a config file.
- Supports a separate auditor agent or a built-in heuristic auditor.
- Re-prompts automatically using the last failed audit.
- Enforces budgets by attempts, runtime, estimated USD, or estimated tokens.
- Stores every prompt, result, verification log, and audit packet under `.vibecodemax/runs/...`.
- Works best with CLI-driven tools today and can be adapted to GUI/editor tools through wrappers.

## Current Scope

This repo ships the first working CLI MVP.

It is strongest when your agent can be launched non-interactively from a shell command. That covers tools like local CLIs directly. GUI tools and editor extensions can still participate, but only if you expose them through a wrapper script or task that can consume a prompt file and return control to the orchestrator.

Fully seamless GUI automation is not solved in this first version, because true autonomous retries require a scriptable entry point.

## Quick Start

```bash
npm install
npm run build
node dist/src/cli.js run examples/basic.config.json
```

The demo config uses a fake primary agent and a fake auditor so you can verify the loop end-to-end before wiring in a real model.

## How It Works

1. VibeCodeMax loads a JSON config.
2. It writes a primary prompt file for the current attempt.
3. It runs your configured primary agent command.
4. It runs verification commands against the workspace.
5. It snapshots git-visible workspace changes.
6. It asks the configured auditor whether the task is complete.
7. If the answer is `continue`, it builds the next prompt from the audit feedback and repeats.

## Config Shape

```json
{
  "workspace": ".",
  "task": {
    "title": "Finish the feature",
    "objective": "Implement the full task, not a partial draft.",
    "completionCriteria": [
      "Tests pass.",
      "Required files exist."
    ],
    "contextFiles": ["README.md", "src/index.ts"]
  },
  "budgets": {
    "mode": "bounded",
    "maxAttempts": 8,
    "maxRuntimeMinutes": 90,
    "maxUsd": 15
  },
  "agents": {
    "primary": {
      "model": "your-model-name",
      "command": "your-primary-agent-command"
    },
    "auditor": {
      "model": "your-auditor-model",
      "command": "your-auditor-command"
    }
  },
  "run": {
    "primaryAgent": "primary",
    "auditorAgent": "auditor",
    "requiredFiles": ["README.md"],
    "verification": [
      {
        "name": "tests",
        "command": "npm test"
      }
    ],
    "maxNoChangeAttempts": 3
  }
}
```

## Budgets

- `mode: "bounded"`: stop when a configured limit is reached. If you omit `maxAttempts`, the default is `10`.
- `mode: "until_complete"`: keep going until the auditor marks it complete, unless another budget like `maxUsd` or `maxRuntimeMinutes` is also set.

## Integrating Your Agent

Each agent profile is just a shell command plus optional metadata.

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

## Claude Code / Codex / VS Code / GUI Notes

- If your tool already has a non-interactive CLI, point `command` at it directly.
- If your tool is GUI-first, create a local wrapper that reads `VCM_PROMPT_FILE`, launches the tool against `VCM_WORKSPACE`, waits for completion, and then exits.
- The auditor command must return JSON on stdout:

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
- `examples/wrappers/run-primary-agent-template.ps1`: Windows wrapper template for a real primary agent.
- `examples/wrappers/run-auditor-template.ps1`: Windows wrapper template for a real auditor.

## Development

```bash
npm install
npm run build
npm test
```

## Roadmap

- Interactive local dashboard for live runs.
- First-class provider presets instead of wrapper-only integration.
- Better diff scoring and completion detection.
- Session resume and pause controls.
- Per-agent spend tracking from real API usage instead of estimates.

