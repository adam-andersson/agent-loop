import { blockingFindings, formatFindings, runCodex } from "./lib/codex.ts";
import { planPrompt } from "./lib/prompts.ts";
import { emit, hookContext, readHookInput } from "./lib/state.ts";
import type { PlanState } from "./lib/types.ts";

const NEW_RUN: PlanState = { round: 0, lastReport: null };

function respond(permissionDecision: "ask" | "deny", reason: string, notice = reason.split("\n")[0]): void {
  emit({
    systemMessage: notice,
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason: reason },
  });
}

// "ask", never "allow": the user always makes the final call on a plan. The approval dialog
// shows the reason under the plan.
function askUser(reason: string): void {
  respond("ask", reason);
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
    askUser(`Codex: plan NOT reviewed (${result.reason}). Approve without a review, or reject to retry.`);
    return;
  }

  const { summary, findings } = result.review;
  const blocking = blockingFindings(result.review);
  const header = `Codex plan review (${config.model}, round ${round}/${config.planRounds})`;
  if (blocking.length > 0 && round < config.planRounds) {
    save("plan", { round, lastReport: result.review });
    respond(
      "deny",
      `${header}: revise. ${summary}\n${formatFindings(findings)}\nTriage each finding with the agent-loop:codex-review skill, revise the plan, and call ExitPlanMode again.`,
      `${header}: revise, ${blocking.length} blocking finding${blocking.length === 1 ? "" : "s"} sent back to Claude.`
    );
    return;
  }

  // The run ends here: the user decides, and a revision after a rejection starts a new run.
  save("plan", NEW_RUN);
  const verdict = blocking.length > 0 ? `needs your decision, ${blocking.length} blocking after ${round} rounds` : "approve";
  askUser(`${header}: ${verdict}. ${summary}${findings.length > 0 ? `\n${formatFindings(findings)}` : ""}`);
}

try {
  main();
} catch (error) {
  respond("ask", `Codex review hook failed (${(error as Error).message}); the plan was not reviewed.`);
}
