import { createHash } from "node:crypto";
import { runCodex } from "./lib/codex.mjs";
import { decideRound } from "./lib/decide.mjs";
import { saveLedger } from "./lib/ledger.mjs";
import { planPrompt } from "./lib/prompts.mjs";
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

function respond(permissionDecision, permissionDecisionReason, notice = permissionDecisionReason.split("\n")[0]) {
  emit({
    systemMessage: notice,
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason },
  });
}

function askUser(context, plan, reason) {
  context.ledger.plan.awaitingHuman = { planHash: createHash("sha256").update(plan).digest("hex") };
  saveLedger(context.paths, context.ledger);
  respond("ask", reason);
}

function main() {
  const input = readHookInput();
  const context = hookContext(input);
  const { config, paths, ledger, dispositions, ignored } = context;
  const plan = input.tool_input?.plan ?? "";

  if (ledger.plan.awaitingHuman) {
    ledger.plan.awaitingHuman = null;
    ledger.plan.rounds = 0;
    ledger.plan.inferredRejections = (ledger.plan.inferredRejections ?? 0) + 1;
    acknowledgeHandOffs(ledger);
  }

  const waiting = needsHuman(ledger, "plan", dispositions);
  if (waiting.length > 0) {
    recordHandOff(ledger, waiting, dispositions);
    askUser(
      context,
      plan,
      `Codex review paused: Opus marked ${waiting.map((finding) => finding.id).join(", ")} needs-human.\n${waiting
        .map((finding) => `${formatFinding(finding)}\n  Opus: ${dispositions[finding.id].evidence}`)
        .join("\n")}`
    );
    return;
  }

  const round = ledger.plan.rounds + 1;
  const result = runCodex({
    prompt: planPrompt({
      plan,
      carried: openFindings(ledger, "plan"),
      dispositions,
      round,
      cap: config.planRounds,
    }),
    cwd: context.root ?? input.cwd,
    outputDir: paths.reviews,
    label: `plan-${round}`,
    config,
  });
  ledger.reviews.push({ phase: "plan", round, model: config.model, status: result.status, rawPath: result.rawPath });

  if (result.status === "not-reviewed") {
    askUser(context, plan, `Codex: plan NOT reviewed (${result.reason}). Decide without a review, or reject to retry.`);
    return;
  }

  const decision = decideRound({
    phase: "plan",
    findings: ledger.findings,
    nextId: ledger.nextId.plan,
    rounds: ledger.plan.rounds,
    cap: config.planRounds,
    review: result.review,
    dispositions: decisionDispositions(ledger, dispositions),
  });
  ledger.findings = decision.findings;
  ledger.nextId.plan = decision.nextId;
  ledger.plan.rounds = decision.rounds;
  ledger.reviews.at(-1).outcome = decision.outcome;

  const header = `Codex plan review (${config.model}, round ${round}/${config.planRounds})`;
  if (decision.outcome === "block") {
    saveLedger(paths, ledger);
    const others = openFindings(ledger, "plan").filter((finding) => finding.severity !== "blocking");
    respond(
      "deny",
      `${header}: revise. ${result.review.summary}\nBlocking:\n${decision.openBlocking.map(formatFinding).join("\n")}${
        others.length > 0 ? `\nOther open findings:\n${others.map(formatFinding).join("\n")}` : ""
      }\n${triageInstructions(paths, ignored)} Then revise the plan and call ExitPlanMode again.`,
      `${header}: revise, ${decision.openBlocking.length} blocking finding${
        decision.openBlocking.length === 1 ? "" : "s"
      } sent back to Opus.`
    );
    return;
  }
  if (decision.outcome === "escalate") {
    askUser(
      context,
      plan,
      `${header}: needs your decision (${decision.reasons.join("; ")}).\n${decision.openBlocking.map(formatFinding).join("\n")}`
    );
    return;
  }
  const nonBlocking = openFindings(ledger, "plan");
  askUser(
    context,
    plan,
    `${header}: approve. ${result.review.summary}${
      nonBlocking.length > 0
        ? `\nOpen non-blocking: ${nonBlocking.map((finding) => `${finding.id} ${finding.claim}`).join("; ")}`
        : ""
    }`
  );
}

try {
  main();
} catch (error) {
  respond("ask", `Codex review hook failed (${error.message}); the plan was not reviewed.`);
}
