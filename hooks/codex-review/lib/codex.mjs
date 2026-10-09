import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = fileURLToPath(new URL("../schema.json", import.meta.url));
const SEVERITIES = new Set(["blocking", "non-blocking", "nit"]);
const RESOLUTION_STATUSES = new Set(["resolved", "still-open", "withdrawn"]);

export function runCodex({ prompt, cwd, outputDir, label, config, env = process.env }) {
  mkdirSync(outputDir, { recursive: true });
  const rawPath = path.join(outputDir, `${label}-${Date.now()}.json`);
  const args = ["exec", "-s", "read-only", "-m", config.model];
  if (config.effort) args.push("-c", `model_reasoning_effort=${config.effort}`);
  args.push("--output-schema", SCHEMA_PATH, "-o", rawPath, "-C", cwd, "-");

  const run = spawnSync(env.CODEX_BIN ?? "codex", args, {
    input: prompt,
    env,
    encoding: "utf8",
    timeout: config.timeoutSec * 1000,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (run.error?.code === "ETIMEDOUT") return notReviewed(`codex timed out after ${config.timeoutSec}s`, rawPath);
  if (run.error) return notReviewed(`codex could not start: ${run.error.message}`, rawPath);
  if (run.status !== 0) return notReviewed(`codex exited with ${run.status ?? run.signal}`, rawPath);

  let text;
  try {
    text = readFileSync(rawPath, "utf8");
  } catch {
    return notReviewed("codex wrote no final message", rawPath);
  }
  if (text.trim() === "") return notReviewed("codex returned an empty final message", rawPath);

  let review;
  try {
    review = JSON.parse(text);
  } catch {
    return notReviewed("codex's final message is not valid JSON", rawPath);
  }
  const problem = shapeProblem(review);
  if (problem) return notReviewed(problem, rawPath);
  return { status: "reviewed", review, rawPath };
}

function notReviewed(reason, rawPath) {
  return { status: "not-reviewed", reason, rawPath };
}

function shapeProblem(review) {
  if (!["approve", "revise"].includes(review?.verdict)) return "review has no valid verdict";
  if (!Array.isArray(review.findings) || !Array.isArray(review.resolutions)) {
    return "review is missing findings or resolutions";
  }
  if (!Array.isArray(review.files_inspected) || review.files_inspected.length === 0) {
    return "review inspected no files";
  }
  if (review.findings.some((finding) => !SEVERITIES.has(finding?.severity))) {
    return "review has a finding with an unknown severity";
  }
  if (review.resolutions.some((resolution) => !RESOLUTION_STATUSES.has(resolution?.status))) {
    return "review has a resolution with an unknown status";
  }
  return undefined;
}
