import { blockingFindings, formatFindings, runCodex } from "./lib/codex.ts";
import { loadConfig } from "./lib/config.ts";
import { snapshotTree } from "./lib/git.ts";
import { codePrompt } from "./lib/prompts.ts";
import { emit, hookContext, readHookInput } from "./lib/state.ts";

// After the cap, the user may ask for more rounds while Claude only answers the findings, leaving
// the tree unchanged. Claude ends that reply with this line to have the same tree reviewed again.
const REVIEW_AGAIN = "Codex: review again";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function main() {
  const input = readHookInput();
  const { root, reviews, load, save } = hookContext(input);
  const code = load("code");
  if (!code || !root) return;

  const tree = snapshotTree(root);
  if (tree === code.base) return;
  const reviewAgain = code.lastOutcome === "escalate" && input.last_assistant_message?.trimEnd().split("\n").at(-1) === REVIEW_AGAIN;
  if (tree === code.lastTree && !reviewAgain) {
    // Claude stopped without changing anything since the last review: let it stop, and tell the
    // user what is still open rather than blocking on a condition that will not change.
    if (code.lastOutcome === "block" && code.lastReport) {
      const open = blockingFindings(code.lastReport).length;
      emit({ systemMessage: `Claude stopped with ${plural(open, "blocking Codex finding")} open; see its reply and ${code.lastReportPath}.` });
    }
    return;
  }

  const config = loadConfig();
  const round = code.round + 1;
  const result = runCodex({
    prompt: codePrompt({
      plan: code.plan,
      previous: code.lastReport,
      reply: input.last_assistant_message,
      base: code.base,
      lastTree: code.lastTree,
      tree,
      round,
      cap: config.codeRounds,
    }),
    cwd: root,
    outputDir: reviews,
    label: `code-${round}`,
    config,
  });
  // Not saved, so the next stop retries the same tree.
  if (result.status === "not-reviewed") {
    emit({ systemMessage: `Codex: changes NOT reviewed (${result.reason}).` });
    return;
  }

  const { summary, findings } = result.review;
  const blocking = blockingFindings(result.review);
  const header = `Codex code review (${config.model}, round ${round}/${config.codeRounds})`;
  const reviewed = { ...code, lastTree: tree, lastReport: result.review, lastReportPath: result.rawPath };

  if (blocking.length === 0) {
    save("code", { ...reviewed, base: tree, round: 0, lastOutcome: "pass", lastTree: null, lastReport: null });
    const notes = findings.length > 0 ? ` ${plural(findings.length, "non-blocking finding")} in ${result.rawPath}.` : "";
    emit({ systemMessage: `${header}: pass. ${summary}${notes}` });
    return;
  }

  if (round < config.codeRounds) {
    save("code", { ...reviewed, round, lastOutcome: "block" });
    emit({
      decision: "block",
      reason: `${header}: revise. ${summary}\n${formatFindings(findings)}\nTriage each finding with the agent-loop:codex-review skill: fix what holds up, answer the rest with evidence in your reply, then stop again. The next round reviews the whole section.`,
    });
    return;
  }

  // At the cap the user decides, so nothing stays open unseen: block once for Claude to put the
  // choice to the user. The round count resets, so more rounds start a fresh run; the base stays,
  // so they still cover the unresolved section, and only a pass moves it.
  save("code", { ...reviewed, round: 0, lastOutcome: "escalate" });
  emit({
    decision: "block",
    reason: `${header}: needs the user's decision, ${plural(blocking.length, "blocking finding")} open after the round cap. ${summary}\n${formatFindings(blocking)}\nChange no code now. List each blocker with your triage, then ask the user whether to run more rounds or accept them as open, and stop. Follow the agent-loop:codex-review skill for either answer.`,
  });
}

try {
  main();
} catch (error) {
  emit({ systemMessage: `Codex review hook failed (${(error as Error).message}); changes were not reviewed.` });
}
