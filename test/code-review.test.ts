import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { blockingFinding, planApproved, reviewJson, revise, setup, stop } from "./helpers.ts";

function approved(options?: Parameters<typeof setup>[0]) {
  const t = setup(options);
  t.commitAll("init");
  t.run("plan-approved.ts", planApproved("# The approved plan"));
  return t;
}

function diffRange(stdin: string): string[] {
  return stdin.match(/git diff ([0-9a-f]{40}) ([0-9a-f]{40})/)!.slice(1);
}

test("plan approval records the approved plan, including dialog edits, and the tree as the section base", () => {
  const t = setup();
  t.run("plan-approved.ts", { ...planApproved("# Edited in the dialog"), tool_input: { plan: "# As proposed" } });
  const code = t.state("code");
  assert.equal(code.plan, "# Edited in the dialog");
  assert.match(code.base, /^[0-9a-f]{40}$/);
  assert.equal(code.round, 0);
});

test("a plan approved while an option is invalid is still recorded, and reviewed once the option is fixed", () => {
  const t = setup();
  t.commitAll("init");
  t.run("plan-approved.ts", planApproved("# Approved with a bad option"), { CLAUDE_PLUGIN_OPTION_TIMEOUTSEC: "abc" });
  const code = t.state("code");
  assert.equal(code.plan, "# Approved with a bad option");
  assert.match(code.base, /^[0-9a-f]{40}$/);
  t.respondWith(reviewJson());
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop());
  assert.match(t.codexCalls()[0].stdin, /# Approved with a bad option/);
});

test("plan approval outside a git repository leaves the code loop off", () => {
  const t = setup({ repo: false });
  t.run("plan-approved.ts", planApproved());
  t.write("a.txt", "changed\n");
  assert.deepEqual(t.run("code-review.ts", stop()).output, {});
  assert.equal(t.codexCalls().length, 0);
});

test("does nothing without an approved plan", () => {
  const t = setup();
  t.write("a.txt", "changed\n");
  assert.deepEqual(t.run("code-review.ts", stop()).output, {});
  assert.equal(t.codexCalls().length, 0);
});

test("does nothing while nothing changed since the plan was approved", () => {
  const t = approved();
  assert.deepEqual(t.run("code-review.ts", stop()).output, {});
  assert.equal(t.codexCalls().length, 0);
});

test("blocks the stop with Codex's blocking findings and points Claude to triage", () => {
  const t = approved();
  t.respondWith(revise(blockingFinding({ claim: "drops the last row" })));
  t.write("a.txt", "changed\n");
  const { output } = t.run("code-review.ts", stop());
  assert.equal(output.decision, "block");
  assert.match(output.reason, /drops the last row/);
  assert.match(output.reason, /codex-review/);
  assert.equal(t.state("code").round, 1);
});

test("the prompt carries the approved plan and Claude's reply as untrusted material, after the instructions", () => {
  const t = approved();
  t.respondWith(reviewJson());
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop({ last_assistant_message: "Section done; tests green." }));
  const prompt = t.codexCalls()[0].stdin;
  const untrusted = prompt.indexOf("<untrusted_material>");
  assert.ok(untrusted > 0);
  assert.ok(prompt.indexOf("# The approved plan") > untrusted);
  assert.ok(prompt.indexOf("Section done; tests green.") > untrusted);
  assert.doesNotMatch(prompt, /<\/untrusted_material>/);
});

test("a fix is reviewed as the whole section, with the previous report and Claude's reply, and a pass advances the base", () => {
  const t = approved();
  t.respondWith(revise(blockingFinding({ claim: "drops the last row" })), reviewJson({ summary: "Ship it." }));
  const { base } = t.state("code");
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop());
  const blockedTree = t.state("code").lastTree;
  t.write("a.txt", "fixed\n");
  const { output } = t.run("code-review.ts", stop({ stop_hook_active: true, last_assistant_message: "Fixed the off-by-one." }));
  assert.equal(output.decision, undefined);
  assert.match(output.systemMessage, /pass\. Ship it\./);
  const second = t.codexCalls()[1].stdin;
  const [from, to] = diffRange(second);
  assert.equal(from, base);
  assert.match(second, new RegExp(`git diff ${blockedTree} ${to}`));
  assert.match(second, /drops the last row/);
  assert.match(second, /Fixed the off-by-one\./);
  const code = t.state("code");
  assert.equal(code.base, to);
  assert.equal(code.round, 0);
});

test("a pass tells the user how many non-blocking findings there are and where the report is", () => {
  const t = approved();
  t.respondWith(reviewJson({ findings: [blockingFinding({ severity: "non-blocking" })] }));
  t.write("a.txt", "changed\n");
  const { output } = t.run("code-review.ts", stop());
  assert.match(output.systemMessage, /1 non-blocking finding in .*code-1-\d+\.json/);
});

test("does not review again after a pass while the tree is unchanged", () => {
  const t = approved();
  t.respondWith(reviewJson());
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop());
  assert.deepEqual(t.run("code-review.ts", stop()).output, {});
  assert.equal(t.codexCalls().length, 1);
});

test("a stop with the tree unchanged after a block is let through with a notice, without another review", () => {
  const t = approved();
  t.respondWith(revise());
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop());
  const { output } = t.run("code-review.ts", stop({ stop_hook_active: true }));
  assert.equal(output.decision, undefined);
  assert.match(output.systemMessage, /1 blocking Codex finding open/);
  assert.equal(t.codexCalls().length, 1);
});


test("a failed review lets the stop through with a notice, and the next stop retries", () => {
  const t = approved();
  t.write("a.txt", "changed\n");
  const failed = t.run("code-review.ts", stop(), { FAKE_CODEX_MODE: "exit-nonzero" });
  assert.match(failed.output.systemMessage, /NOT reviewed/);
  t.respondWith(reviewJson());
  t.run("code-review.ts", stop());
  assert.equal(t.codexCalls().length, 2);
});

test("lets the stop through with a notice when the hook itself fails", () => {
  const t = approved();
  t.write("a.txt", "changed\n");
  const result = t.run("code-review.ts", stop(), { CLAUDE_PLUGIN_OPTION_TIMEOUTSEC: "abc" });
  assert.equal(result.status, 0);
  assert.equal(result.output.decision, undefined);
  assert.match(result.output.systemMessage, /not reviewed/);
});

test("at the round cap the stop is blocked once for Claude to ask the user, and the base stays", () => {
  const t = approved({ config: { codeRounds: 2 } });
  t.respondWith(revise(), revise(blockingFinding({ claim: "still broken" })));
  const { base } = t.state("code");
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop());
  t.write("a.txt", "changed again\n");
  const { output } = t.run("code-review.ts", stop({ stop_hook_active: true }));
  assert.equal(output.decision, "block");
  assert.match(output.reason, /needs the user's decision[\s\S]*still broken[\s\S]*more rounds or accept/);
  assert.equal(t.state("code").base, base);
  // The stop after Claude has asked the user goes through without another review.
  assert.deepEqual(t.run("code-review.ts", stop({ stop_hook_active: true })).output, {});
  assert.equal(t.codexCalls().length, 2);
});

test("more rounds after the cap: a changed tree starts a fresh run over the whole unresolved section", () => {
  const t = approved({ config: { codeRounds: 1 } });
  t.respondWith(revise(), revise());
  const { base } = t.state("code");
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop());
  t.run("code-review.ts", stop());
  t.write("unrelated.txt", "later edit\n");
  const { output } = t.run("code-review.ts", stop());
  assert.equal(output.decision, "block");
  const prompt = t.codexCalls()[1].stdin;
  assert.match(prompt, /review round 1 of/);
  assert.equal(diffRange(prompt)[0], base);
});

test("more rounds after the cap without edits: the review-again line reviews the unchanged tree with Claude's reply", () => {
  const t = approved({ config: { codeRounds: 1 } });
  t.respondWith(revise(blockingFinding({ claim: "the disputed bug" })), reviewJson());
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop());
  t.run("code-review.ts", stop({ last_assistant_message: "Do you want more rounds, or accept?" }));
  const reply = "The disputed bug is not real: test/a.test.ts passes.";
  assert.deepEqual(t.run("code-review.ts", stop({ last_assistant_message: reply })).output, {});
  assert.equal(t.codexCalls().length, 1);
  const { output } = t.run("code-review.ts", stop({ last_assistant_message: `${reply}\nCodex: review again` }));
  assert.match(output.systemMessage, /pass/);
  const prompt = t.codexCalls()[1].stdin;
  assert.match(prompt, /review round 1 of/);
  assert.match(prompt, /test\/a\.test\.ts passes/);
  assert.match(prompt, /the disputed bug/);
});

test("a revised plan approved with unreviewed edits replaces the plan and keeps them in the section", () => {
  const t = setup();
  t.commitAll("init");
  t.run("plan-approved.ts", planApproved("# Plan A: multiply rejects strings"));
  const { base } = t.state("code");
  t.write("a.txt", "changed\n");
  t.run("plan-approved.ts", planApproved("# Plan B: multiply accepts strings via int()"));
  t.respondWith(reviewJson());
  t.run("code-review.ts", stop());
  const prompt = t.codexCalls()[0].stdin;
  assert.equal(diffRange(prompt)[0], base);
  assert.match(prompt, /# Plan B/);
  assert.doesNotMatch(prompt, /# Plan A/);
});

test("a new plan approved after a pass starts from the passed tree", () => {
  const t = approved();
  t.respondWith(reviewJson(), reviewJson());
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop());
  const passed = t.state("code").base;
  t.run("plan-approved.ts", planApproved("# Plan B"));
  t.write("a.txt", "next feature\n");
  t.run("code-review.ts", stop());
  const prompt = t.codexCalls()[1].stdin;
  assert.equal(diffRange(prompt)[0], passed);
  assert.match(prompt, /# Plan B/);
});

test("a plan approved after the round cap keeps the unresolved section in review", () => {
  const t = approved({ config: { codeRounds: 1 } });
  t.respondWith(revise(), revise());
  const { base } = t.state("code");
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop());
  t.run("plan-approved.ts", planApproved("# Plan B"));
  assert.equal(t.state("code").base, base);
  t.run("code-review.ts", stop());
  const prompt = t.codexCalls()[1].stdin;
  assert.equal(diffRange(prompt)[0], base);
  assert.match(prompt, /# Plan B/);
});

test("edits made after the round cap stay in review when a plan is approved", () => {
  const t = approved({ config: { codeRounds: 1 } });
  t.respondWith(revise(), reviewJson());
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop());
  const { base } = t.state("code");
  t.write("a.txt", "changed after the cap\n");
  t.run("plan-approved.ts", planApproved("# Plan B"));
  t.run("code-review.ts", stop());
  assert.equal(t.codexCalls().length, 2);
  assert.equal(diffRange(t.codexCalls()[1].stdin)[0], base);
});

test("a revised plan approved after a block, with no edit, is reviewed afresh from the section base", () => {
  const t = approved();
  const { base } = t.state("code");
  t.respondWith(revise(blockingFinding({ claim: "drift from the plan" })), revise());
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop());
  t.run("plan-approved.ts", planApproved("# Plan B"));
  const { output } = t.run("code-review.ts", stop());
  assert.equal(t.codexCalls().length, 2);
  const prompt = t.codexCalls()[1].stdin;
  assert.equal(diffRange(prompt)[0], base);
  assert.match(prompt, /# Plan B/);
  assert.doesNotMatch(prompt, /drift from the plan/);
  assert.match(prompt, /review round 1 of/);
  assert.equal(output.decision, "block");
});

test("a plan approved in the main checkout gates a stop in a linked worktree", () => {
  const t = approved();
  const { base } = t.state("code");
  const worktree = t.addWorktree("wt");
  writeFileSync(path.join(worktree, "a.txt"), "changed in the worktree\n");
  t.respondWith(revise());
  const { output } = t.run("code-review.ts", { ...stop(), cwd: worktree });
  assert.equal(output.decision, "block");
  assert.equal(diffRange(t.codexCalls()[0].stdin)[0], base);
});

test("two repositories in one session keep separate plans, bases and rounds", () => {
  const t = approved();
  const other = path.join(t.base, "other");
  execFileSync("git", ["init", "-q", "-b", "main", other]);
  writeFileSync(path.join(other, "b.txt"), "one\n");
  t.commitAll("init", other);
  t.run("plan-approved.ts", { ...planApproved("# Other plan"), cwd: other });
  t.respondWith(revise());
  t.write("a.txt", "changed\n");
  t.run("code-review.ts", stop());
  assert.equal(t.state("code").plan, "# The approved plan");
  assert.equal(t.state("code").round, 1);
  assert.equal(t.state("code", other).plan, "# Other plan");
  assert.equal(t.state("code", other).round, 0);
});

test("a submodule's plan and section are separate from its superproject's", () => {
  const t = approved();
  const upstream = path.join(t.base, "upstream");
  execFileSync("git", ["init", "-q", "-b", "main", upstream]);
  writeFileSync(path.join(upstream, "s.txt"), "one\n");
  t.commitAll("upstream", upstream);
  execFileSync("git", ["-C", t.cwd, "-c", "protocol.file.allow=always", "submodule", "add", "-q", upstream, "sub"]);
  const submodule = path.join(t.cwd, "sub");
  t.run("plan-approved.ts", { ...planApproved("# Submodule plan"), cwd: submodule });
  writeFileSync(path.join(submodule, "s.txt"), "changed\n");
  t.respondWith(revise());
  assert.equal(t.run("code-review.ts", { ...stop(), cwd: submodule }).output.decision, "block");
  assert.match(t.codexCalls()[0].stdin, /# Submodule plan/);
  assert.equal(t.state("code").plan, "# The approved plan");
  assert.equal(t.state("code").round, 0);
});
