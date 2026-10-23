import { test } from "node:test";
import assert from "node:assert/strict";
import { blockingFinding, exitPlanMode, planApproved, reviewJson, revise, setup, type HookResult } from "./helpers.ts";

function decision(result: HookResult) {
  return result.output.hookSpecificOutput;
}

// The plan shown in the approval dialog: the dialog renders the plan, not the reason.
function dialogPlan(result: HookResult): string {
  return decision(result).updatedInput.plan;
}

test("denies the plan with Codex's blocking findings and points Claude to triage", () => {
  const t = setup();
  t.respondWith(revise(blockingFinding({ claim: "the plan skips migration" })));
  const result = t.run("plan-review.ts", exitPlanMode());
  assert.equal(decision(result).permissionDecision, "deny");
  assert.match(decision(result).permissionDecisionReason, /the plan skips migration/);
  assert.match(decision(result).permissionDecisionReason, /codex-review/);
  assert.equal(decision(result).updatedInput, undefined);
  assert.equal(t.state("plan").round, 1);
});

test("asks the user, never allows, when Codex finds no blocker, with the review and its findings as the reason", () => {
  const t = setup();
  t.respondWith(reviewJson({ summary: "Looks sound.", findings: [blockingFinding({ severity: "non-blocking", claim: "a cheaper option" })] }));
  const input = exitPlanMode("# The plan\n\nSteps.");
  const run = t.run("plan-review.ts", { ...input, tool_input: { ...input.tool_input, other: "kept" } });
  const result = decision(run);
  assert.equal(result.permissionDecision, "ask");
  assert.match(result.permissionDecisionReason, /approve\. Looks sound\.[\s\S]*a cheaper option/);
  assert.ok(dialogPlan(run).startsWith("# The plan\n\nSteps."));
  assert.match(dialogPlan(run), /## Codex review[\s\S]*approve\. Looks sound\.[\s\S]*a cheaper option/);
  assert.equal(result.updatedInput.other, "kept");
  assert.ok(dialogPlan(run).includes(t.state("plan").reviewToken!));
});

test("the review comes off the approved plan, and the user's dialog edits stay", () => {
  const t = setup();
  t.commitAll("init");
  t.respondWith(reviewJson({ summary: "Looks sound." }));
  const shown = dialogPlan(t.run("plan-review.ts", exitPlanMode("# The plan")));
  t.run("plan-approved.ts", planApproved(`Edit above.\n\n${shown}\n\nEdit below.`));
  assert.equal(t.state("code").plan, "Edit above.\n\n# The plan\n\nEdit below.");
});

test("a revised plan is reviewed with Codex's previous report, and the run ends when the user decides", () => {
  const t = setup();
  t.respondWith(revise(blockingFinding({ claim: "the plan skips migration" })), reviewJson());
  t.run("plan-review.ts", exitPlanMode("# First draft"));
  const result = decision(t.run("plan-review.ts", exitPlanMode("# Revised draft")));
  assert.equal(result.permissionDecision, "ask");
  const second = t.codexCalls()[1].stdin;
  assert.match(second, /# Revised draft/);
  assert.match(second, /the plan skips migration/);
  assert.equal(t.state("plan").round, 0);
});

test("at the round cap with blockers open, sends them to Claude to put the choice to the user", () => {
  const t = setup({ config: { planRounds: 2 } });
  t.respondWith(revise(), revise(blockingFinding({ claim: "still unsafe" })));
  assert.equal(decision(t.run("plan-review.ts", exitPlanMode())).permissionDecision, "deny");
  const result = t.run("plan-review.ts", exitPlanMode());
  assert.equal(decision(result).permissionDecision, "deny");
  assert.match(decision(result).permissionDecisionReason, /needs the user's decision[\s\S]*still unsafe[\s\S]*AskUserQuestion/);
  assert.match(result.output.systemMessage, /needs your decision/);
  assert.equal(t.state("plan").round, 0);
});

test("after the cap, the unchanged plan goes to the dialog with the open blockers and no new review", () => {
  const t = setup({ config: { planRounds: 1 } });
  t.respondWith(revise(blockingFinding({ claim: "still unsafe" })));
  t.run("plan-review.ts", exitPlanMode("# The plan"));
  const result = t.run("plan-review.ts", exitPlanMode("# The plan"));
  assert.equal(decision(result).permissionDecision, "ask");
  assert.equal(t.codexCalls().length, 1);
  assert.match(dialogPlan(result), /accepted with 1 blocking open[\s\S]*still unsafe/);
});

test("after the cap, a revised plan starts a new run with the previous report and the plan's review notes", () => {
  const t = setup({ config: { planRounds: 1 } });
  t.respondWith(revise(blockingFinding({ claim: "still unsafe" })), reviewJson());
  t.run("plan-review.ts", exitPlanMode("# The plan"));
  const result = decision(t.run("plan-review.ts", exitPlanMode("# The plan\n\n## Review notes\n\nsafe: see a.ts:1")));
  assert.equal(result.permissionDecision, "ask");
  const second = t.codexCalls()[1].stdin;
  assert.match(second, /round 1 of at most 1/);
  assert.match(second, /## Your previous report[\s\S]*still unsafe/);
  assert.match(second, /safe: see a\.ts:1/);
});

// A blocked round, a failed one, then a retry: the failure neither counts a round nor drops the report.
function assertRunResumes(t: ReturnType<typeof setup>) {
  assert.equal(t.state("plan").round, 1);
  assert.match(t.state("plan").lastReport!.findings[0].claim, /the plan skips migration/);
  t.run("plan-review.ts", exitPlanMode());
  const retry = t.codexCalls().at(-1)!.stdin;
  assert.match(retry, /review round 2 of at most 3/);
  assert.match(retry, /the plan skips migration/);
}

test("asks the user when the review failed, without counting a round or losing the run", () => {
  const t = setup();
  t.respondWith(revise(blockingFinding({ claim: "the plan skips migration" })), reviewJson());
  t.run("plan-review.ts", exitPlanMode());
  const result = t.run("plan-review.ts", exitPlanMode(), { FAKE_CODEX_MODE: "exit-nonzero" });
  assert.equal(decision(result).permissionDecision, "ask");
  assert.match(decision(result).permissionDecisionReason, /NOT reviewed/);
  assert.match(dialogPlan(result), /NOT reviewed/);
  assertRunResumes(t);
});

test("asks the user when the hook itself fails, without losing the run", () => {
  const t = setup();
  t.respondWith(revise(blockingFinding({ claim: "the plan skips migration" })), reviewJson());
  t.run("plan-review.ts", exitPlanMode());
  const result = t.run("plan-review.ts", exitPlanMode(), { CLAUDE_PLUGIN_OPTION_TIMEOUTSEC: "abc" });
  assert.equal(result.status, 0);
  assert.equal(decision(result).permissionDecision, "ask");
  assert.match(decision(result).permissionDecisionReason, /not reviewed/);
  assert.match(dialogPlan(result), /^# Plan[\s\S]*hook failed[\s\S]*not reviewed/);
  assertRunResumes(t);
});

test("approving after a failed review ends the run and takes the warning off the plan", () => {
  const t = setup();
  t.commitAll("init");
  t.respondWith(revise());
  t.run("plan-review.ts", exitPlanMode("# The plan"));
  const shown = dialogPlan(t.run("plan-review.ts", exitPlanMode("# The plan"), { FAKE_CODEX_MODE: "exit-nonzero" }));
  t.run("plan-approved.ts", planApproved(shown));
  assert.equal(t.state("plan").round, 0);
  assert.equal(t.state("code").plan, "# The plan");
});

test("the warning from a failed hook comes off the approved plan too", () => {
  const t = setup();
  t.commitAll("init");
  const shown = dialogPlan(t.run("plan-review.ts", exitPlanMode("# The plan"), { CLAUDE_PLUGIN_OPTION_TIMEOUTSEC: "abc" }));
  t.run("plan-approved.ts", planApproved(`${shown}\n\nEdit below.`));
  assert.equal(t.state("code").plan, "# The plan\n\nEdit below.");
});

test("every outcome tells the user in one line what Codex did with the plan", () => {
  const t = setup();
  t.respondWith(revise(), reviewJson());
  assert.match(t.run("plan-review.ts", exitPlanMode()).output.systemMessage, /^Codex plan review .*revise, 1 blocking finding sent back to Claude\.$/);
  assert.match(t.run("plan-review.ts", exitPlanMode()).output.systemMessage, /^Codex plan review .*approve\. summary$/);
});

test("approving the plan ends the plan run", () => {
  const t = setup();
  t.respondWith(revise());
  t.run("plan-review.ts", exitPlanMode());
  t.run("plan-approved.ts", planApproved());
  assert.equal(t.state("plan").round, 0);
});
