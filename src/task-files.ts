import type { ContextSnippet } from "./types.js";

const CHECKLIST_ITEM_PATTERN = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/gmu;
const UNREADABLE_PREFIX = "Unable to read file:";
const MAX_UNCHECKED_PREVIEW = 5;

export interface TaskChecklistSummary {
  path: string;
  unreadable: boolean;
  checkedCount: number;
  uncheckedCount: number;
  uncheckedItems: string[];
}

export function summarizeTaskSnippet(snippet: ContextSnippet): TaskChecklistSummary {
  const matches = Array.from(snippet.content.matchAll(CHECKLIST_ITEM_PATTERN));
  const uncheckedItems = matches
    .filter((match) => match[1] !== "x" && match[1] !== "X")
    .map((match) => match[2]?.trim() ?? "")
    .filter(Boolean);

  return {
    path: snippet.path,
    unreadable: snippet.content.startsWith(UNREADABLE_PREFIX),
    checkedCount: matches.length - uncheckedItems.length,
    uncheckedCount: uncheckedItems.length,
    uncheckedItems,
  };
}

export function summarizeTaskSnippets(snippets: ContextSnippet[]): TaskChecklistSummary[] {
  return snippets.map((snippet) => summarizeTaskSnippet(snippet));
}

export function renderTaskChecklistSummary(summary: TaskChecklistSummary): string {
  if (summary.unreadable) {
    return "Checklist status: unreadable.";
  }

  if (summary.checkedCount === 0 && summary.uncheckedCount === 0) {
    return "Checklist status: no markdown checkboxes detected.";
  }

  if (summary.uncheckedCount === 0) {
    return `Checklist status: ${summary.checkedCount} checked, 0 unchecked.`;
  }

  const preview = summary.uncheckedItems.slice(0, MAX_UNCHECKED_PREVIEW);
  const moreCount = summary.uncheckedItems.length - preview.length;
  const unresolved = preview.map((item) => `- ${item}`).join("\n");
  const moreLine = moreCount > 0 ? `\n- ...and ${moreCount} more unchecked item(s)` : "";

  return [
    `Checklist status: ${summary.checkedCount} checked, ${summary.uncheckedCount} unchecked.`,
    "Open checklist items:",
    unresolved,
    moreLine,
  ]
    .filter(Boolean)
    .join("\n");
}

