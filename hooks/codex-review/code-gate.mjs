import { createHash } from "node:crypto";
import { runCodex } from "./lib/codex.mjs";
import { decideRound } from "./lib/decide.mjs";
import { headCommit, headTree, snapshotTree } from "./lib/git.mjs";
import { saveLedger } from "./lib/ledger.mjs";
import { codePrompt } from "./lib/prompts.mjs";
import {
  acknowledgeHandOffs,
  decisionDispositions,
  emit,
  formatFinding,
  hookContext,
  needsHuman,
  openFindings,
  readHookInput,
  recordHandOff,
  triageInstructions,
} from "./lib/runtime.mjs";

function escalate(context, message) {
  const { code } = context.ledger;
  code.escalated = true;
  code.escalatedAtHead = headCommit(context.root);
  saveLedger(context.paths, context.ledger);
  emit({ systemMessage: message });
}

function resumeAfterCommit(code, head) {
  code.escalated = false;
  code.escalatedAtHead = null;
  code.rounds = 0;
  code.cycleBase = head;
  code.lastTree = head;
  code.lastOutcome = null;
  code.stalled = false;
}

function main() {
  const input = readHookInput();
  const context = hookContext(input);
  const { config, root, paths, ledger, dispositions, ignored } = context;
  const { code } = ledger;
  if (!code.active || !root) return;

  if (code.escalated) {
    if (headCommit(root) === code.escalatedAtHead) return;
    resumeAfterCommit(code, headTree(root));
    acknowledgeHandOffs(ledger);
  }

  const waiting = needsHuman(ledger, "code", dispositions);
  if (waiting.length > 0) {
    recordHandOff(ledger, waiting, dispositions);
    escalate(context, `Codex review paused: ${waiting.map((finding) => finding.id).join(", ")} marked needs-human.`);
    return;
  }

  const tree = snapshotTree(root);
  const blockingOpen = openFindings(ledger, "code").some((finding) => finding.severity === "blocking");
  if (!blockingOpen && tree === code.cycleBase) {
    saveLedger(paths, ledger);
    return;
  }

  const dispositionsHash = createHash("sha256").update(JSON.stringify(dispositions)).digest("hex");
  if (tree === code.lastTree && code.lastOutcome === "block" && dispositionsHash === code.lastDispositionsHash) {
    if (code.stalled) {
      const open = openFindings(ledger, "code").filter((finding) => finding.severity === "blocking");
      saveLedger(paths, ledger);
      emit({
        systemMessage: `Opus stopped with ${open.length} blocking finding(s) open: ${open.map((finding) => finding.id).join(", ")}.`,
      });
      return;
    }
    code.stalled = true;
    saveLedger(paths, ledger);
    emit({ decision: "block", reason: code.lastBlockReason });
    return;
  }
  code.stalled = false;

  const round = code.rounds + 1;
  const result = runCodex({
    prompt: codePrompt({
      plan: ledger.plan.approved?.text,
      cycleBase: code.cycleBase,
      lastTree: code.lastTree,
      tree,
      carried: openFindings(ledger, "code"),
      dispositions,
      round,
      cap: config.codeRounds,
    }),
    cwd: root,
    outputDir: paths.reviews,
    label: `code-${round}`,
    config,
  });
  ledger.reviews.push({
    phase: "code",
    round,
    model: config.model,
    range: [code.cycleBase, tree],
    status: result.status,
    rawPath: result.rawPath,
  });

  if (result.status === "not-reviewed") {
    saveLedger(paths, ledger);
    emit({ systemMessage: `Codex: changes NOT reviewed (${result.reason}).` });
    return;
  }

  const decision = decideRound({
    phase: "code",
    findings: ledger.findings,
    nextId: ledger.nextId.code,
    rounds: code.rounds,
    cap: config.codeRounds,
    review: result.review,
    dispositions: decisionDispositions(ledger, dispositions),
  });
  ledger.findings = decision.findings;
  ledger.nextId.code = decision.nextId;
  ledger.reviews.at(-1).outcome = decision.outcome;
  code.rounds = decision.rounds;
  code.lastTree = tree;
  code.lastOutcome = decision.outcome;
  code.lastDispositionsHash = dispositionsHash;

  if (decision.outcome === "block") {
    const others = openFindings(ledger, "code").filter((finding) => finding.severity !== "blocking");
    code.lastBlockReason = `Codex code review (${config.model}, round ${round}/${config.codeRounds}): revise. ${
      result.review.summary
    }\nBlocking:\n${decision.openBlocking.map(formatFinding).join("\n")}${
      others.length > 0 ? `\nOther open findings:\n${others.map(formatFinding).join("\n")}` : ""
    }\n${triageInstructions(paths, ignored)}`;
    saveLedger(paths, ledger);
    emit({ decision: "block", reason: code.lastBlockReason });
    return;
  }

  if (decision.outcome === "pass") {
    code.rounds = 0;
    code.cycleBase = tree;
    saveLedger(paths, ledger);
    const open = openFindings(ledger, "code").length;
    emit({
      systemMessage: `Codex code review (${config.model}, round ${round}/${config.codeRounds}): pass. ${result.review.summary}${
        open > 0 ? ` ${open} non-blocking finding${open === 1 ? "" : "s"} open.` : ""
      }`,
    });
    return;
  }

  escalate(context, `Codex review needs your decision: ${decision.reasons.join("; ")}.`);
}

try {
  main();
} catch (error) {
  emit({ systemMessage: `Codex review hook failed (${error.message}); changes were not reviewed.` });
}
