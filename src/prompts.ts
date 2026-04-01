import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ContextSnippet, NormalizedConfig, VerificationResult } from "./types.js";

const CONTEXT_SNIPPET_LIMIT = 6_000;

export interface TemplateVariables {
  [key: string]: string;
  ATTEMPT: string;
  ROLE: string;
  WORKSPACE: string;
  RUN_DIR: string;
  PROMPT_FILE: string;
  AUDIT_PACKET_FILE: string;
  MODEL: string;
  TASK_TITLE: string;
  OBJECTIVE: string;
  CONFIG_FILE: string;
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\$\{([A-Z0-9_]+)\}/g, (fullMatch, key) => {
    const value = variables[key];
    if (value === undefined) {
      throw new Error(`Unknown template variable ${fullMatch}.`);
    }

    return value;
  });
}

export async function loadContextSnippets(config: NormalizedConfig): Promise<ContextSnippet[]> {
  const snippets: ContextSnippet[] = [];

  for (const relativeFile of config.task.contextFiles) {
    const absoluteFile = path.resolve(config.workspace, relativeFile);

    try {
      const contents = await readFile(absoluteFile, "utf8");
      const truncated = contents.length > CONTEXT_SNIPPET_LIMIT;
      snippets.push({
        path: relativeFile,
        content: truncated ? `${contents.slice(0, CONTEXT_SNIPPET_LIMIT)}\n...[truncated]` : contents,
        truncated,
      });
    } catch (error) {
      snippets.push({
        path: relativeFile,
        content: `Unable to read file: ${(error as Error).message}`,
        truncated: false,
      });
    }
  }

  return snippets;
}

function renderCompletionCriteria(criteria: string[]): string {
  if (criteria.length === 0) {
    return "- No explicit completion criteria were configured.";
  }

  return criteria.map((criterion) => `- ${criterion}`).join("\n");
}

function renderVerificationFailures(results: VerificationResult[]): string {
  const failed = results.filter((result) => result.exitCode !== 0);

  if (failed.length === 0) {
    return "- No verification failures from the previous attempt.";
  }

  return failed
    .map(
      (result) =>
        `- ${result.name}: exit ${result.exitCode}${result.stderr.trim() ? ` | ${result.stderr.trim()}` : ""}`,
    )
    .join("\n");
}

function renderContextSnippets(snippets: ContextSnippet[]): string {
  if (snippets.length === 0) {
    return "No extra context files were configured.";
  }

  return snippets
    .map(
      (snippet) =>
        `## ${snippet.path}\n\`\`\`text\n${snippet.content.trimEnd()}\n\`\`\`${snippet.truncated ? "\n[snippet truncated]" : ""}`,
    )
    .join("\n\n");
}

export function buildPrimaryPrompt(input: {
  config: NormalizedConfig;
  attempt: number;
  previousFeedback?: string;
  previousVerificationResults?: VerificationResult[];
  contextSnippets: ContextSnippet[];
}): string {
  const { config, attempt, previousFeedback, previousVerificationResults, contextSnippets } = input;

  return [
    `# ${config.task.title}`,
    "",
    `Attempt ${attempt}. Work in ${config.workspace}.`,
    "",
    "## Objective",
    config.task.objective,
    "",
    "## Completion Criteria",
    renderCompletionCriteria(config.task.completionCriteria),
    "",
    "## Previous Auditor Feedback",
    previousFeedback?.trim() || "- No prior feedback. Deliver the complete result.",
    "",
    "## Previous Verification Failures",
    renderVerificationFailures(previousVerificationResults ?? []),
    "",
    "## Context",
    renderContextSnippets(contextSnippets),
    "",
    "## Operating Rules",
    "- Make the task actually complete, not partially complete.",
    "- Modify files directly in the workspace.",
    "- Leave the workspace in a verifiable state.",
    "- Prefer decisive changes over incremental stalling.",
  ].join("\n");
}

export function buildAuditPrompt(input: {
  config: NormalizedConfig;
  attempt: number;
  auditPacketFile: string;
}): string {
  const { config, attempt, auditPacketFile } = input;

  return [
    "You are the completion auditor for an autonomous coding run.",
    `Task: ${config.task.title}`,
    `Attempt: ${attempt}`,
    `Audit packet: ${auditPacketFile}`,
    "",
    "Return JSON only with this shape:",
    '{"decision":"complete|continue","summary":"short rationale","nextPrompt":"specific next instruction when continuing"}',
    "",
    "If you choose complete, set nextPrompt to an empty string.",
    "",
    "Mark complete only if the task is genuinely done. Prefer continue over false positives.",
  ].join("\n");
}
