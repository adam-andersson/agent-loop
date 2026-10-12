import { blockingFindings, formatFindings, runCodex } from "./lib/codex.mjs";
import { planPrompt } from "./lib/prompts.mjs";
import { emit, hookContext, readHookInput } from "./lib/state.mjs";

const NEW_RUN = { round: 0, lastReport: null };

function respond(permissionDecision, reason, { notice = reason.split("\n")[0], updatedInput } = {}) {
  emit({
    systemMessage: notice,
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason: reason, updatedInput },
  });
}

// The plan approval dialog shows the plan, so the review is appended to it as well as given as
// the reason. "ask", never "allow": the user always makes the final call on a plan.
function askUser(input, reason) {
  const plan = input.tool_input?.plan ?? "";
  respond("ask", reason, { updatedInput: { ...input.tool_input, plan: `${plan}\n\n---\n\n## Codex review\n\n${reason}\n` } });
}

function main() {
  const input = readHookInput();
  const { config, root, reviews, load, save } = hookContext(input);
  const state = load("plan") ?? NEW_RUN;
  const round = state.round + 1;
  const result = runCodex({
    prompt: planPrompt({ plan: input.tool_input?.plan ?? "", previous: state.lastReport, round, cap: config.planRounds }),
    cwd: root ?? input.cwd,
    outputDir: reviews,
    label: `plan-${round}`,
    config,
  });

  if (result.status === "not-reviewed") {
    save("plan", NEW_RUN);
    askUser(input, `Codex: plan NOT reviewed (${result.reason}). Approve without a review, or reject to retry.`);
    return;
  }

  const { summary, findings } = result.review;
  const blocking = blockingFindings(result.review);
  const header = `Codex plan review (${config.model}, round ${round}/${config.planRounds})`;
  if (blocking.length > 0 && round < config.planRounds) {
    save("plan", { round, lastReport: result.review });
    respond(
      "deny",
      `${header}: revise. ${summary}\n${formatFindings(findings)}\nTriage each finding with the codex-review skill, revise the plan, and call ExitPlanMode again.`,
      { notice: `${header}: revise, ${blocking.length} blocking finding${blocking.length === 1 ? "" : "s"} sent back to Claude.` }
    );
    return;
  }

  // The run ends here: the user decides, and a revision after a rejection starts a new run.
  save("plan", NEW_RUN);
  const verdict = blocking.length > 0 ? `needs your decision, ${blocking.length} blocking after ${round} rounds` : "approve";
  askUser(input, `${header}: ${verdict}. ${summary}${findings.length > 0 ? `\n${formatFindings(findings)}` : ""}`);
}

try {
  main();
} catch (error) {
  respond("ask", `Codex review hook failed (${error.message}); the plan was not reviewed.`);
}
