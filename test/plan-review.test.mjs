import { test } from "node:test";
import assert from "node:assert/strict";
import { blockingFinding, exitPlanMode, planApproved, reviewJson, revise, setup } from "./helpers.mjs";

function decision(result) {
  return result.output.hookSpecificOutput;
}

test("denies the plan with Codex's blocking findings and points Claude to triage", () => {
  const t = setup();
  t.respondWith(revise(blockingFinding({ claim: "the plan skips migration" })));
  const result = t.run("plan-review.mjs", exitPlanMode());
  assert.equal(decision(result).permissionDecision, "deny");
  assert.match(decision(result).permissionDecisionReason, /the plan skips migration/);
  assert.match(decision(result).permissionDecisionReason, /codex-review/);
  assert.equal(decision(result).updatedInput, undefined);
  assert.equal(t.state("plan").round, 1);
});

test("asks the user, never allows, when Codex finds no blocker, with the review and its findings as the reason", () => {
  const t = setup();
  t.respondWith(reviewJson({ summary: "Looks sound.", findings: [blockingFinding({ severity: "non-blocking", claim: "a cheaper option" })] }));
  const result = decision(t.run("plan-review.mjs", exitPlanMode("# The plan\n\nSteps.")));
  assert.equal(result.permissionDecision, "ask");
  assert.match(result.permissionDecisionReason, /approve\. Looks sound\.[\s\S]*a cheaper option/);
  assert.equal(result.updatedInput, undefined);
});

test("a revised plan is reviewed with Codex's previous report, and the run ends when the user decides", () => {
  const t = setup();
  t.respondWith(revise(blockingFinding({ claim: "the plan skips migration" })), reviewJson());
  t.run("plan-review.mjs", exitPlanMode("# First draft"));
  const result = decision(t.run("plan-review.mjs", exitPlanMode("# Revised draft")));
  assert.equal(result.permissionDecision, "ask");
  const second = t.codexCalls()[1].stdin;
  assert.match(second, /# Revised draft/);
  assert.match(second, /the plan skips migration/);
  assert.equal(t.state("plan").round, 0);
});

test("hands the plan to the user at the round cap with the blockers still open", () => {
  const t = setup({ config: { planRounds: 2 } });
  t.respondWith(revise(), revise(blockingFinding({ claim: "still unsafe" })));
  assert.equal(decision(t.run("plan-review.mjs", exitPlanMode())).permissionDecision, "deny");
  const result = t.run("plan-review.mjs", exitPlanMode());
  assert.equal(decision(result).permissionDecision, "ask");
  assert.match(decision(result).permissionDecisionReason, /needs your decision[\s\S]*still unsafe/);
  assert.match(result.output.systemMessage, /needs your decision/);
  assert.equal(t.state("plan").round, 0);
});

test("a run that ends at the user starts over with a fresh round count and no previous report", () => {
  const t = setup({ config: { planRounds: 2 } });
  t.respondWith(revise(), revise(), revise(blockingFinding({ claim: "fresh" })));
  t.run("plan-review.mjs", exitPlanMode());
  t.run("plan-review.mjs", exitPlanMode());
  const result = decision(t.run("plan-review.mjs", exitPlanMode()));
  assert.equal(result.permissionDecision, "deny");
  assert.doesNotMatch(t.codexCalls()[2].stdin, /^## Your previous report/m);
});

test("asks the user when the review failed, without counting a round", () => {
  const t = setup();
  const result = t.run("plan-review.mjs", exitPlanMode(), { FAKE_CODEX_MODE: "exit-nonzero" });
  assert.equal(decision(result).permissionDecision, "ask");
  assert.match(decision(result).permissionDecisionReason, /NOT reviewed/);
  assert.equal(t.state("plan").round, 0);
});

test("asks the user when the hook itself fails", () => {
  const t = setup();
  const result = t.run("plan-review.mjs", exitPlanMode(), { CODEX_REVIEW_CONFIG: "/nonexistent/config.json" });
  assert.equal(result.status, 0);
  assert.equal(decision(result).permissionDecision, "ask");
  assert.match(decision(result).permissionDecisionReason, /not reviewed/);
});

test("every outcome tells the user in one line what Codex did with the plan", () => {
  const t = setup();
  t.respondWith(revise(), reviewJson());
  assert.match(t.run("plan-review.mjs", exitPlanMode()).output.systemMessage, /^Codex plan review .*revise, 1 blocking finding sent back to Claude\.$/);
  assert.match(t.run("plan-review.mjs", exitPlanMode()).output.systemMessage, /^Codex plan review .*approve\. summary$/);
});

test("approving the plan ends the plan run", () => {
  const t = setup();
  t.respondWith(revise());
  t.run("plan-review.mjs", exitPlanMode());
  t.run("plan-approved.mjs", planApproved());
  assert.equal(t.state("plan").round, 0);
});
