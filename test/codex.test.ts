import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCodex } from "../scripts/lib/codex.ts";
import type { Config, Review } from "../scripts/lib/types.ts";

const fakeCodex = fileURLToPath(new URL("fixtures/fake-codex.ts", import.meta.url));
const config: Config = { model: "gpt-6.1-sol", planRounds: 3, codeRounds: 3, timeoutSec: 5 };

function validReview(overrides: object = {}): Review {
  return {
    verdict: "approve",
    summary: "fine",
    files_inspected: ["src/a.ts"],
    findings: [],
    ...overrides,
  };
}

type RunOptions = { mode?: string; response?: object | string; configOverrides?: Partial<Config> };

function run({ mode = "ok", response = validReview(), configOverrides = {} }: RunOptions = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-test-"));
  const responseFile = path.join(dir, "response.json");
  writeFileSync(responseFile, typeof response === "string" ? response : JSON.stringify(response));
  const log = path.join(dir, "log.jsonl");
  const env = {
    ...process.env,
    CODEX_BIN: fakeCodex,
    FAKE_CODEX_MODE: mode,
    FAKE_CODEX_RESPONSES: responseFile,
    FAKE_CODEX_LOG: log,
  };
  const result = runCodex({
    prompt: "review this",
    cwd: dir,
    outputDir: dir,
    label: "code-1",
    config: { ...config, ...configOverrides },
    env,
  });
  let calls: { args: string[]; stdin: string }[] = [];
  try {
    calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  } catch {
    calls = [];
  }
  return { result, calls, dir };
}

test("returns the parsed review for a valid run, and keeps the raw output", () => {
  const finding = { severity: "blocking", claim: "c", evidence: "a.ts:1", recommendation: "r" };
  const { result } = run({ response: validReview({ verdict: "revise", findings: [finding] }) });
  assert.equal(result.status, "reviewed");
  assert.deepEqual(result.review.findings, [finding]);
  assert.equal(JSON.parse(readFileSync(result.rawPath, "utf8")).verdict, "revise");
});

test("names the review schema, whose required fields are exactly what a valid run returns", () => {
  const { calls } = run();
  const { args } = calls[0];
  const schema = JSON.parse(readFileSync(args[args.indexOf("--output-schema") + 1], "utf8"));
  assert.deepEqual(schema.required.sort(), Object.keys(validReview()).sort());
});

test("runs Codex read-only with the configured model, in the given directory, with the prompt on stdin", () => {
  const { calls, dir } = run();
  const [{ args, stdin }] = calls;
  const valueOf = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(args[0], "exec");
  assert.equal(valueOf("-s"), "read-only");
  assert.equal(valueOf("-m"), "gpt-6.1-sol");
  assert.equal(valueOf("-C"), dir);
  assert.equal(args.at(-1), "-");
  assert.equal(stdin, "review this");
});

test("adds the reasoning effort only when configured", () => {
  assert.ok(!run().calls[0].args.some((arg: string) => arg.startsWith("model_reasoning_effort")));
  const { calls } = run({ configOverrides: { effort: "high" } });
  assert.ok(calls[0].args.includes("model_reasoning_effort=high"));
});

for (const [mode, reason] of [
  ["exit-nonzero", /exit/i],
  ["empty", /empty/i],
  ["garbage", /json/i],
] as const) {
  test(`a ${mode} run is not reviewed`, () => {
    const { result } = run({ mode });
    assert.equal(result.status, "not-reviewed");
    assert.match(result.reason, reason);
  });
}

test("a run that exceeds the timeout is not reviewed", () => {
  const { result } = run({ mode: "hang", configOverrides: { timeoutSec: 1 } });
  assert.equal(result.status, "not-reviewed");
  assert.match(result.reason, /timed out/i);
});

const finding = { severity: "blocking", claim: "c", evidence: "e", recommendation: "r" };
for (const [label, response] of [
  ["missing required fields", { verdict: "approve" }],
  ["no inspected files", validReview({ files_inspected: [] })],
  ["a non-string inspected file", validReview({ files_inspected: [null] })],
  ["a finding with only a severity", validReview({ findings: [{ severity: "blocking" }] })],
  ["a finding with a non-string claim", validReview({ findings: [{ ...finding, claim: 1 }] })],
  ["a finding with an unknown severity", validReview({ findings: [{ ...finding, severity: "critical" }] })],
] as [string, object][]) {
  test(`a review with ${label} is not reviewed`, () => {
    const { result } = run({ response });
    assert.equal(result.status, "not-reviewed");
  });
}
