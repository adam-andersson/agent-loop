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

test("returns the parsed review for a valid run", () => {
  const finding = { severity: "blocking", claim: "c", evidence: "a.ts:1", recommendation: "r" };
  const { result } = run({ response: validReview({ verdict: "revise", findings: [finding] }) });
  assert.equal(result.status, "reviewed");
  assert.deepEqual(result.review.findings, [finding]);
});

test("names the review schema, whose required fields are exactly what a valid run returns", () => {
  const { calls } = run();
  const { args } = calls[0];
  const schema = JSON.parse(readFileSync(args[args.indexOf("--output-schema") + 1], "utf8"));
  assert.deepEqual(schema.required.sort(), Object.keys(validReview()).sort());
});

test("passes the prompt on stdin and names model, sandbox and schema explicitly", () => {
  const { calls, dir } = run();
  const [{ args, stdin }] = calls;
  assert.equal(stdin, "review this");
  assert.deepEqual(args.slice(0, 5), ["exec", "-s", "read-only", "-m", "gpt-6.1-sol"]);
  assert.ok(args.includes("--output-schema"));
  assert.equal(args[args.indexOf("-C") + 1], dir);
  assert.equal(args.at(-1), "-");
});

test("adds the reasoning effort only when configured", () => {
  assert.ok(!run().calls[0].args.some((arg: string) => arg.startsWith("model_reasoning_effort")));
  const { calls } = run({ configOverrides: { effort: "high" } });
  assert.ok(calls[0].args.includes("model_reasoning_effort=high"));
});

test("keeps the raw output in the output directory", () => {
  const { result } = run();
  assert.equal(JSON.parse(readFileSync(result.rawPath, "utf8")).verdict, "approve");
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

test("a review that inspected no files is not reviewed", () => {
  const { result } = run({ response: validReview({ files_inspected: [] }) });
  assert.equal(result.status, "not-reviewed");
  assert.match(result.reason, /no files/i);
});

test("a review missing required fields is not reviewed", () => {
  const { result } = run({ response: { verdict: "approve" } });
  assert.equal(result.status, "not-reviewed");
});

for (const [label, overrides] of [
  ["a non-string inspected file", { files_inspected: [null] }],
  ["a finding with only a severity", { findings: [{ severity: "blocking" }] }],
  ["a finding with a non-string claim", { findings: [{ severity: "blocking", claim: 1, evidence: "e", recommendation: "r" }] }],
] as [string, object][]) {
  test(`a review with ${label} is not reviewed`, () => {
    const { result } = run({ response: validReview(overrides) });
    assert.equal(result.status, "not-reviewed");
  });
}

test("a finding with an unknown severity is not reviewed", () => {
  const { result } = run({
    response: validReview({ findings: [{ severity: "critical", claim: "c", evidence: "e", recommendation: "r" }] }),
  });
  assert.equal(result.status, "not-reviewed");
});
