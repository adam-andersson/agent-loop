import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRound, parseDispositions } from "../scripts/lib/decide.mjs";

function finding(overrides = {}) {
  return {
    id: "x",
    severity: "blocking",
    area: "src/a.ts:1",
    claim: "claim",
    evidence: "evidence",
    confidence: "high",
    recommendation: "fix it",
    ...overrides,
  };
}

function review({ findings = [], resolutions = [] } = {}) {
  return { verdict: "revise", summary: "s", files_inspected: ["a"], findings, resolutions };
}

function round(overrides = {}) {
  return decideRound({
    phase: "code",
    findings: {},
    nextId: 1,
    rounds: 0,
    cap: 3,
    review: review(),
    dispositions: {},
    ...overrides,
  });
}

test("passes when the review has no findings and nothing is carried", () => {
  assert.equal(round().outcome, "pass");
});

test("blocks on a new blocking finding and assigns it a hook-owned id", () => {
  const result = round({ review: review({ findings: [finding({ id: "codex-chosen" })] }) });
  assert.equal(result.outcome, "block");
  assert.deepEqual(Object.keys(result.findings), ["C1"]);
  assert.equal(result.findings.C1.status, "open");
  assert.equal(result.nextId, 2);
});

test("uses the P prefix for plan findings", () => {
  const result = round({ phase: "plan", review: review({ findings: [finding()] }) });
  assert.deepEqual(Object.keys(result.findings), ["P1"]);
});

test("passes with only non-blocking findings and keeps them open until Codex closes them", () => {
  const result = round({ review: review({ findings: [finding({ severity: "non-blocking" })] }) });
  assert.equal(result.outcome, "pass");
  assert.equal(result.findings.C1.status, "open");
});

test("closes a carried finding only when Codex marks it resolved", () => {
  const carried = { C1: { ...finding(), id: "C1", phase: "code", status: "open" } };
  const result = round({
    findings: carried,
    nextId: 2,
    rounds: 1,
    review: review({ resolutions: [{ id: "C1", status: "resolved", evidence: "fixed in diff" }] }),
  });
  assert.equal(result.findings.C1.status, "resolved");
  assert.equal(result.outcome, "pass");
});

test("treats a carried finding missing from resolutions as still open", () => {
  const carried = { C1: { ...finding(), id: "C1", phase: "code", status: "open" } };
  const result = round({ findings: carried, nextId: 2, rounds: 1 });
  assert.equal(result.findings.C1.status, "open");
  assert.equal(result.outcome, "block");
});

test("withdrawn closes a carried finding", () => {
  const carried = { C1: { ...finding(), id: "C1", phase: "code", status: "open" } };
  const result = round({
    findings: carried,
    nextId: 2,
    rounds: 1,
    review: review({ resolutions: [{ id: "C1", status: "withdrawn", evidence: "rejection holds" }] }),
  });
  assert.equal(result.findings.C1.status, "withdrawn");
  assert.equal(result.outcome, "pass");
});

test("a disposition claiming the finding is fixed does not close it", () => {
  const carried = { C1: { ...finding(), id: "C1", phase: "code", status: "open" } };
  const result = round({
    findings: carried,
    nextId: 2,
    rounds: 1,
    dispositions: { C1: { id: "C1", disposition: "accepted", evidence: "fixed, trust me" } },
  });
  assert.equal(result.findings.C1.status, "open");
  assert.equal(result.outcome, "block");
});

test("escalates when Codex keeps a finding open that Opus rejected with evidence", () => {
  const carried = { C1: { ...finding(), id: "C1", phase: "code", status: "open" } };
  const result = round({
    findings: carried,
    nextId: 2,
    rounds: 1,
    dispositions: { C1: { id: "C1", disposition: "rejected", evidence: "not reachable" } },
    review: review({ resolutions: [{ id: "C1", status: "still-open", evidence: "reachable via x" }] }),
  });
  assert.equal(result.outcome, "escalate");
  assert.match(result.reasons.join(" "), /C1/);
});

test("escalates when an open finding is marked needs-human", () => {
  const carried = { C1: { ...finding(), id: "C1", phase: "code", status: "open" } };
  const result = round({
    findings: carried,
    nextId: 2,
    rounds: 1,
    dispositions: { C1: { id: "C1", disposition: "needs-human", evidence: "design choice" } },
  });
  assert.equal(result.outcome, "escalate");
});

test("escalates at the round cap when blocking findings remain", () => {
  const result = round({ rounds: 2, review: review({ findings: [finding()] }) });
  assert.equal(result.outcome, "escalate");
  assert.match(result.reasons.join(" "), /round/i);
});

test("ignores carried findings from the other phase", () => {
  const carried = { P1: { ...finding(), id: "P1", phase: "plan", status: "open" } };
  const result = round({ findings: carried, nextId: 1 });
  assert.equal(result.outcome, "pass");
  assert.equal(result.findings.P1.status, "open");
});

test("parseDispositions keeps valid entries for known ids", () => {
  const { dispositions, ignored } = parseDispositions(
    JSON.stringify([{ id: "C1", disposition: "accepted", evidence: "test added" }]),
    ["C1"]
  );
  assert.deepEqual(Object.keys(dispositions), ["C1"]);
  assert.deepEqual(ignored, []);
});

test("parseDispositions ignores unknown ids and invalid dispositions with a note", () => {
  const { dispositions, ignored } = parseDispositions(
    JSON.stringify([
      { id: "C9", disposition: "accepted", evidence: "e" },
      { id: "C1", disposition: "resolved", evidence: "e" },
    ]),
    ["C1"]
  );
  assert.deepEqual(dispositions, {});
  assert.equal(ignored.length, 2);
});

test("parseDispositions ignores a malformed file with a note", () => {
  const { dispositions, ignored } = parseDispositions("{not json", ["C1"]);
  assert.deepEqual(dispositions, {});
  assert.equal(ignored.length, 1);
});

test("parseDispositions treats a missing file as no dispositions", () => {
  assert.deepEqual(parseDispositions(undefined, ["C1"]), { dispositions: {}, ignored: [] });
});
