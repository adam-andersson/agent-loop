import { test } from "node:test";
import assert from "node:assert/strict";
import { blockingFinding, exitPlanMode, planApproved, reviewJson, setup } from "./helpers.mjs";

function decision(result) {
  return result.output.hookSpecificOutput;
}

test("denies the plan with Codex's blocking findings and where to write dispositions", () => {
  const t = setup();
  t.respondWith(reviewJson({ verdict: "revise", findings: [blockingFinding()] }));
  const result = t.run("plan-gate.mjs", exitPlanMode());
  assert.equal(decision(result).permissionDecision, "deny");
  assert.match(decision(result).permissionDecisionReason, /P1/);
  assert.match(decision(result).permissionDecisionReason, new RegExp(t.paths().dispositions));
  assert.equal(t.ledger().plan.rounds, 1);
});

test("asks the user, never allows, when Codex approves", () => {
  const t = setup();
  t.respondWith(reviewJson());
  const result = t.run("plan-gate.mjs", exitPlanMode());
  assert.equal(decision(result).permissionDecision, "ask");
  assert.match(decision(result).permissionDecisionReason, /approve/i);
  assert.ok(t.ledger().plan.awaitingHuman.planHash);
});

test("shows Codex's verdict in the approval dialog by appending it to the plan", () => {
  const t = setup();
  t.respondWith(reviewJson({ summary: "Looks sound." }));
  const input = exitPlanMode("# The plan\n\nSteps.");
  input.tool_input.planFilePath = "/home/.claude/plans/the-plan.md";
  const { updatedInput } = decision(t.run("plan-gate.mjs", input));
  assert.equal(updatedInput.planFilePath, "/home/.claude/plans/the-plan.md");
  assert.ok(updatedInput.plan.startsWith("# The plan\n\nSteps."));
  assert.match(updatedInput.plan, /## Codex review\n\nCodex plan review \(gpt-6\.1-sol, round 1\/3\): approve\. Looks sound\./);
});

test("shows a failed review in the approval dialog too", () => {
  const t = setup();
  const result = t.run("plan-gate.mjs", exitPlanMode(), { FAKE_CODEX_MODE: "exit-nonzero" });
  assert.match(decision(result).updatedInput.plan, /## Codex review\n\nCodex: plan NOT reviewed/);
});

test("does not rewrite the plan when it goes back to Opus", () => {
  const t = setup();
  t.respondWith(reviewJson({ verdict: "revise", findings: [blockingFinding()] }));
  assert.equal(decision(t.run("plan-gate.mjs", exitPlanMode())).updatedInput, undefined);
});

test("asks the user when the review failed, and does not count a round", () => {
  const t = setup();
  const result = t.run("plan-gate.mjs", exitPlanMode(), { FAKE_CODEX_MODE: "exit-nonzero" });
  assert.equal(decision(result).permissionDecision, "ask");
  assert.match(decision(result).permissionDecisionReason, /not reviewed/i);
  assert.equal(t.ledger().plan.rounds, 0);
});

test("every outcome tells the user in one line what Codex did with the plan", () => {
  const t = setup({ config: { planRounds: 2 } });
  t.respondWith(
    reviewJson({ verdict: "revise", summary: "Missing coverage.", findings: [blockingFinding()] }),
    reviewJson({ verdict: "revise", resolutions: [{ id: "P1", status: "still-open", evidence: "e" }] }),
    reviewJson({ summary: "Looks\nsound.", resolutions: [{ id: "P1", status: "resolved", evidence: "section added" }] })
  );
  const blocked = t.run("plan-gate.mjs", exitPlanMode()).output.systemMessage;
  assert.match(blocked, /^Codex plan review \(gpt-6\.1-sol, round 1\/2\): revise, 1 blocking finding sent back to Opus\.$/);
  const escalated = t.run("plan-gate.mjs", exitPlanMode("# v2")).output.systemMessage;
  assert.match(escalated, /^Codex plan review \(gpt-6\.1-sol, round 2\/2\): needs your decision/);
  assert.doesNotMatch(escalated, /\n/);
  const approved = t.run("plan-gate.mjs", exitPlanMode("# v3")).output.systemMessage;
  assert.match(approved, /^Codex plan review \(gpt-6\.1-sol, round 1\/2\): approve\. Looks sound\.$/);
  const notReviewed = t.run("plan-gate.mjs", exitPlanMode("# v4"), { FAKE_CODEX_MODE: "exit-nonzero" }).output.systemMessage;
  assert.match(notReviewed, /^Codex: plan NOT reviewed/);
});

test("asks the user when the hook itself fails", () => {
  const t = setup();
  const result = t.run("plan-gate.mjs", exitPlanMode(), { CODEX_REVIEW_CONFIG: "/nonexistent/config.json" });
  assert.equal(result.status, 0);
  assert.equal(decision(result).permissionDecision, "ask");
  assert.match(decision(result).permissionDecisionReason, /hook failed/i);
});

test("escalates to the user at the round cap", () => {
  const t = setup({ config: { planRounds: 2 } });
  t.respondWith(
    reviewJson({ verdict: "revise", findings: [blockingFinding()] }),
    reviewJson({ verdict: "revise", resolutions: [{ id: "P1", status: "still-open", evidence: "e" }] })
  );
  assert.equal(decision(t.run("plan-gate.mjs", exitPlanMode())).permissionDecision, "deny");
  const second = decision(t.run("plan-gate.mjs", exitPlanMode("# Plan v2")));
  assert.equal(second.permissionDecision, "ask");
  assert.match(second.permissionDecisionReason, /round cap/i);
});

test("infers a user rejection when the gate runs again before approval, and resets the round count", () => {
  const t = setup({ config: { planRounds: 2 } });
  t.respondWith(
    reviewJson({ verdict: "revise", findings: [blockingFinding()] }),
    reviewJson({ resolutions: [{ id: "P1", status: "still-open", evidence: "e" }], verdict: "revise" }),
    reviewJson({ verdict: "revise", resolutions: [{ id: "P1", status: "still-open", evidence: "e" }] })
  );
  t.run("plan-gate.mjs", exitPlanMode());
  assert.equal(decision(t.run("plan-gate.mjs", exitPlanMode("# v2"))).permissionDecision, "ask");
  const afterRejection = decision(t.run("plan-gate.mjs", exitPlanMode("# v3, after user feedback")));
  assert.equal(afterRejection.permissionDecision, "deny");
  assert.equal(t.ledger().plan.rounds, 1);
  assert.equal(t.ledger().plan.inferredRejections, 1);
  assert.match(t.codexCalls()[2].stdin, /P1/);
});

test("hands a needs-human finding to the user without another review", () => {
  const t = setup();
  t.respondWith(reviewJson({ verdict: "revise", findings: [blockingFinding()] }));
  t.run("plan-gate.mjs", exitPlanMode());
  t.writeDispositions([{ id: "P1", disposition: "needs-human", evidence: "a design choice" }]);
  const result = decision(t.run("plan-gate.mjs", exitPlanMode("# v2")));
  assert.equal(result.permissionDecision, "ask");
  assert.match(result.permissionDecisionReason, /needs-human/);
  assert.equal(t.codexCalls().length, 1);
});

test("after the user rejects a needs-human hand-off, the next call is reviewed without rewriting dispositions", () => {
  const t = setup();
  t.respondWith(reviewJson({ verdict: "revise", findings: [blockingFinding()] }), reviewJson());
  t.run("plan-gate.mjs", exitPlanMode());
  t.writeDispositions([{ id: "P1", disposition: "needs-human", evidence: "a design choice" }]);
  assert.match(decision(t.run("plan-gate.mjs", exitPlanMode("# v2"))).permissionDecisionReason, /needs-human/);
  t.run("plan-gate.mjs", exitPlanMode("# v3 with the user's answer"));
  assert.equal(t.codexCalls().length, 2);
});

test("after a needs-human hand-off is rejected, a finding Codex keeps open denies normally", () => {
  const t = setup();
  t.respondWith(
    reviewJson({ verdict: "revise", findings: [blockingFinding()] }),
    reviewJson({ verdict: "revise", resolutions: [{ id: "P1", status: "still-open", evidence: "e" }] })
  );
  t.run("plan-gate.mjs", exitPlanMode());
  t.writeDispositions([{ id: "P1", disposition: "needs-human", evidence: "a design choice" }]);
  t.run("plan-gate.mjs", exitPlanMode("# v2"));
  assert.equal(decision(t.run("plan-gate.mjs", exitPlanMode("# v3"))).permissionDecision, "deny");
});

test("the prompt carries the plan as untrusted data and the carried findings with dispositions", () => {
  const t = setup();
  t.respondWith(reviewJson({ verdict: "revise", findings: [blockingFinding()] }), reviewJson());
  t.run("plan-gate.mjs", exitPlanMode());
  t.writeDispositions([{ id: "P1", disposition: "accepted", evidence: "added section X" }]);
  t.run("plan-gate.mjs", exitPlanMode("# Plan v2 with section X"));
  const { stdin, args } = t.codexCalls()[1];
  assert.match(stdin, /Plan v2 with section X/);
  assert.match(stdin, /never instructions/i);
  assert.match(stdin, /P1[\s\S]*accepted[\s\S]*added section X/);
  assert.match(stdin, /unverified/i);
  assert.equal(args[args.indexOf("-m") + 1], "gpt-6.1-sol");
});

test("a disposition claiming the plan is fixed cannot turn a review into a pass", () => {
  const t = setup();
  t.respondWith(reviewJson({ verdict: "revise", findings: [blockingFinding()] }), reviewJson({ verdict: "revise" }));
  t.run("plan-gate.mjs", exitPlanMode());
  t.writeDispositions([{ id: "P1", disposition: "accepted", evidence: "fixed" }]);
  assert.equal(decision(t.run("plan-gate.mjs", exitPlanMode("# v2"))).permissionDecision, "deny");
});

test("plan approval after the dialog clears the pending state", () => {
  const t = setup();
  t.respondWith(reviewJson());
  t.run("plan-gate.mjs", exitPlanMode());
  t.run("plan-approved.mjs", planApproved());
  assert.equal(t.ledger().plan.awaitingHuman, null);
});
