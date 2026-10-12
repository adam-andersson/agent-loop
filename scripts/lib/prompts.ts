import { readFileSync } from "node:fs";
import { formatFindings } from "./codex.ts";
import type { Review } from "./types.ts";

// A loop's prompt is its own template, then the shared rules, which end by opening the
// untrusted material; the material follows and is never closed.
function prompt(loop: string, values: Record<string, string | number>, sections: [string, string | null | undefined][]): string {
  const read = (name: string) => readFileSync(new URL(`../../prompts/${name}.md`, import.meta.url), "utf8");
  const template = read(loop).replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key]));
  const material = sections
    .filter(([, body]) => body)
    .map(([heading, body]) => `## ${heading}\n\n${body}`)
    .join("\n\n");
  return `${template}\n${read("review-rules")}\n${material}\n`;
}

function report(review: Review | null): string | null {
  return review && `${review.summary}\n\n${formatFindings(review.findings) || "No findings."}`;
}

type PlanPromptOptions = { plan: string; previous: Review | null; round: number; cap: number };

export function planPrompt({ plan, previous, round, cap }: PlanPromptOptions): string {
  return prompt("plan-review", { round, cap }, [
    ["Your previous report", report(previous)],
    ["The plan", plan],
  ]);
}

type CodePromptOptions = {
  plan: string;
  previous: Review | null;
  reply: string | undefined;
  base: string;
  lastTree: string | null;
  tree: string;
  round: number;
  cap: number;
};

export function codePrompt({ plan, previous, reply, base, lastTree, tree, round, cap }: CodePromptOptions): string {
  const sinceLastRound = lastTree
    ? `Changed since your previous report: \`git diff ${lastTree} ${tree}\`. Look there first, but review the whole section.`
    : "This is the first round for this section.";
  return prompt("code-review", { round, cap, base, tree, sinceLastRound }, [
    ["The approved plan", plan || "(no plan text recorded)"],
    ["Your previous report", report(previous)],
    ["Claude's reply", reply],
  ]);
}
