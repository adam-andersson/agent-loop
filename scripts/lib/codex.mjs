import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = fileURLToPath(new URL("../../schemas/review.json", import.meta.url));
const SEVERITIES = new Set(["blocking", "non-blocking"]);
const FINDING_TEXT = ["claim", "evidence", "recommendation"];

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
  return { status: "reviewed", review: { ...review, summary: review.summary.replace(/\s+/g, " ").trim() }, rawPath };
}

function notReviewed(reason, rawPath) {
  return { status: "not-reviewed", reason, rawPath };
}

function shapeProblem(review) {
  if (!["approve", "revise"].includes(review?.verdict)) return "review has no valid verdict";
  if (typeof review.summary !== "string" || !Array.isArray(review.findings)) return "review is missing its summary or findings";
  if (!Array.isArray(review.files_inspected) || review.files_inspected.length === 0) {
    return "review inspected no files";
  }
  if (review.files_inspected.some((file) => typeof file !== "string")) return "review lists a file that is not a path";
  if (review.findings.some((finding) => !SEVERITIES.has(finding?.severity))) {
    return "review has a finding with an unknown severity";
  }
  if (review.findings.some((finding) => FINDING_TEXT.some((field) => typeof finding[field] !== "string"))) {
    return "review has a finding without its claim, evidence or recommendation";
  }
  return undefined;
}

export function blockingFindings(review) {
  return review.findings.filter((finding) => finding.severity === "blocking");
}

export function formatFindings(findings) {
  return findings
    .map((finding) => `- [${finding.severity}] ${finding.claim}\n  Evidence: ${finding.evidence}\n  Recommendation: ${finding.recommendation}`)
    .join("\n");
}
