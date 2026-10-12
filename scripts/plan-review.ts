import { randomUUID } from "node:crypto";
import { blockingFindings, formatFindings, runCodex } from "./lib/codex.ts";
import { loadConfig } from "./lib/config.ts";
import { planPrompt } from "./lib/prompts.ts";
import { withReview } from "./lib/review-block.ts";
import { emit, hookContext, readHookInput } from "./lib/state.ts";
import type { HookInput, PlanState } from "./lib/types.ts";

const NEW_RUN: PlanState = { round: 0, lastReport: null };

type Respond = { notice?: string; updatedInput?: HookInput["tool_input"] };

function respond(permissionDecision: "ask" | "deny", reason: string, { notice = reason.split("\n")[0], updatedInput }: Respond = {}): void {
  emit({
    systemMessage: notice,
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason: reason, updatedInput },
  });
}

// "ask", never "allow": the user always makes the final call on a plan. The approval dialog
// renders only the plan, so the review is appended to it, under a token plan-approved.ts uses
// to take it off again. Without parsed input there is no plan to append to.
function askUser(input: HookInput | undefined, reason: string, save?: (state: PlanState) => void): void {
  if (!input) return respond("ask", reason);
  const token = randomUUID();
  save?.({ ...NEW_RUN, reviewToken: token });
  const plan = withReview(input.tool_input?.plan ?? "", reason, token);
  respond("ask", reason, { updatedInput: { ...input.tool_input, plan } });
}

let input: HookInput | undefined;

function main() {
  input = readHookInput();
  const config = loadConfig();
  const { root, reviews, load, save } = hookContext(input);
  const endRun = (state: PlanState) => save("plan", state);
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
    askUser(input, `Codex: plan NOT reviewed (${result.reason}). Approve without a review, or reject to retry.`, endRun);
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
      { notice: `${header}: revise, ${blocking.length} blocking finding${blocking.length === 1 ? "" : "s"} sent back to Claude.` }
    );
    return;
  }

  // The run ends here: the user decides, and a revision after a rejection starts a new run, so
  // rejecting at the cap is how the user asks for more rounds.
  const verdict = blocking.length > 0 ? `needs your decision, ${blocking.length} blocking after ${round} rounds` : "approve";
  const choice =
    blocking.length > 0 ? "\nReject and ask Claude to continue to start a new review run, or approve to accept these blockers as open." : "";
  askUser(input, `${header}: ${verdict}. ${summary}${findings.length > 0 ? `\n${formatFindings(findings)}` : ""}${choice}`, endRun);
}

try {
  main();
} catch (error) {
  // The state is saved here too, so approval takes the warning off the plan; if the state itself
  // is what failed, the warning still reaches the dialog and stays in the recorded plan.
  const endRun = (state: PlanState) => {
    try {
      hookContext(input!).save("plan", state);
    } catch {}
  };
  askUser(input, `Codex review hook failed (${(error as Error).message}); the plan was not reviewed.`, endRun);
}
