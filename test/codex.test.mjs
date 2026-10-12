import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCodex } from "../scripts/lib/codex.mjs";

const fakeCodex = fileURLToPath(new URL("fixtures/fake-codex.mjs", import.meta.url));
const config = { model: "gpt-6.1-sol", timeoutSec: 5 };

function validReview(overrides = {}) {
  return {
    verdict: "approve",
    summary: "fine",
    files_inspected: ["src/a.ts"],
    findings: [],
    resolutions: [],
    ...overrides,
  };
}

function run({ mode = "ok", response = validReview(), configOverrides = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-test-"));
  const responseFile = path.join(dir, "response.json");
  writeFileSync(responseFile, typeof response === "string" ? response : JSON.stringify(response));
  const log = path.join(dir, "log.jsonl");
  const env = {
    ...process.env,
    CODEX_BIN: fakeCodex,
    FAKE_CODEX_MODE: mode,
    FAKE_CODEX_RESPONSE: responseFile,
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
  let calls = [];
  try {
    calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  } catch {
    calls = [];
  }
  return { result, calls, dir };
}

test("returns the parsed review for a valid run", () => {
  const { result } = run();
  assert.equal(result.status, "reviewed");
  assert.equal(result.review.verdict, "approve");
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
  assert.ok(!run().calls[0].args.some((arg) => arg.startsWith("model_reasoning_effort")));
  const { calls } = run({ configOverrides: { effort: "high" } });
  assert.ok(calls[0].args.includes("model_reasoning_effort=high"));
});

test("keeps the raw output next to the ledger", () => {
  const { result } = run();
  assert.equal(JSON.parse(readFileSync(result.rawPath, "utf8")).verdict, "approve");
});

for (const [mode, reason] of [
  ["exit-nonzero", /exit/i],
  ["empty", /empty/i],
  ["garbage", /json/i],
]) {
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

test("a finding with an unknown severity is not reviewed", () => {
  const { result } = run({
    response: validReview({
      findings: [
        {
          id: "1",
          severity: "critical",
          area: "a",
          claim: "c",
          evidence: "e",
          confidence: "high",
          recommendation: "r",
        },
      ],
    }),
  });
  assert.equal(result.status, "not-reviewed");
});
