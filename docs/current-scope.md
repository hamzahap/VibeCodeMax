# Current Scope

This file is the repo-owned definition of done for VibeCodeMax self-host runs.

## Product Contract

VibeCodeMax is complete for the current scope when it delivers a strong CLI-first autonomous retry loop for coding agents, not a promise of universal GUI automation.

## Definition of Done

- The orchestrator can run a primary agent, run verification, audit the result, and retry until the auditor marks the task complete or a configured stop condition is hit.
- Native adapters exist for both `codex exec` and `claude -p`.
- The config supports a dedicated scope document through `task.scopeFile`, and that scope document is included in the primary prompt and audit packet.
- The CLI can inspect a completed run and summarize the attempt timeline.
- The repository ships self-host configs for both Codex and Claude that point at this scope file.
- `npm test` passes in this repository.
- The repo documentation explains how to update this scope and rerun the self-host loop against the new scope.

## Explicitly Out of Scope

- Seamless automation of GUI-only tools without any wrapper or scriptable entry point.
- Real provider billing integration or exact spend reconciliation.
- A dashboard, pause/resume controls, or multi-run orchestration UX.

## How to Expand Scope

1. Edit this file to change the definition of done.
2. Update verification commands, required files, or budgets in the self-host configs if the new scope needs stronger proof.
3. Rerun `npm run self-host:codex` or `npm run self-host:claude`.
4. Inspect the finished run with `node dist/src/cli.js inspect latest`.

The self-host loop should only be considered 100% complete relative to the current contents of this file.
