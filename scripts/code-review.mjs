import { blockingFindings, formatFindings, runCodex } from "./lib/codex.mjs";
import { snapshotTree } from "./lib/git.mjs";
import { codePrompt } from "./lib/prompts.mjs";
import { emit, hookContext, readHookInput } from "./lib/state.mjs";

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function main() {
  const input = readHookInput();
  const { config, root, reviews, load, save } = hookContext(input);
  const code = load("code");
  if (!code || !root) return;

  const tree = snapshotTree(root);
  if (tree === code.base) return;
  if (tree === code.lastTree) {
    // Claude stopped without changing anything since the last review: let it stop, and tell the
    // user what is still open rather than blocking on a condition that will not change.
    if (code.lastOutcome === "block") {
      const open = blockingFindings(code.lastReport).length;
      emit({ systemMessage: `Claude stopped with ${plural(open, "blocking Codex finding")} open; see its reply and ${code.lastReportPath}.` });
    }
    return;
  }

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
      reason: `${header}: revise. ${summary}\n${formatFindings(findings)}\nTriage each finding with the codex-review skill: fix what holds up, answer the rest with evidence in your reply, then stop again. The next round reviews the whole section.`,
    });
    return;
  }

  // At the cap the user decides. The base stays, so later rounds still cover the unresolved
  // section; it moves on a pass or a new plan approval.
  save("code", { ...reviewed, round, lastOutcome: "escalate" });
  emit({ systemMessage: `${header}: needs your decision, ${plural(blocking.length, "blocking finding")} open. ${summary}\n${formatFindings(blocking)}` });
}

try {
  main();
} catch (error) {
  emit({ systemMessage: `Codex review hook failed (${error.message}); changes were not reviewed.` });
}
