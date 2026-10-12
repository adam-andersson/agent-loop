import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ledgerPaths, loadLedger, saveLedger } from "../lib/ledger.mjs";

const hooksDir = fileURLToPath(new URL("..", import.meta.url));
const fakeCodex = fileURLToPath(new URL("fixtures/fake-codex.mjs", import.meta.url));

export function blockingFinding(overrides = {}) {
  return {
    id: "1",
    severity: "blocking",
    area: "src/a.ts:1",
    claim: "the bug",
    evidence: "src/a.ts:1 shows it",
    confidence: "high",
    recommendation: "fix it",
    ...overrides,
  };
}

export function reviewJson(overrides = {}) {
  return {
    verdict: "approve",
    summary: "summary",
    files_inspected: ["src/a.ts"],
    findings: [],
    resolutions: [],
    ...overrides,
  };
}

export function setup({ repo = true, config = {} } = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "hooks-test-")));
  const home = path.join(base, "home");
  const cwd = path.join(base, "repo");
  execFileSync("mkdir", ["-p", cwd, home]);
  if (repo) {
    execFileSync("git", ["-C", cwd, "init", "-q", "-b", "main"]);
    writeFileSync(path.join(cwd, "a.txt"), "one\n");
  }
  const configPath = path.join(base, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({ model: "gpt-6.1-sol", planRounds: 3, codeRounds: 3, timeoutSec: 5, ...config })
  );
  const responses = [];
  const counter = path.join(base, "counter");
  const log = path.join(base, "codex-log.jsonl");

  const context = {
    base,
    home,
    cwd,
    sessionId: "session-1",
    respondWith(...reviews) {
      for (const review of reviews) {
        const file = path.join(base, `response-${responses.length}.json`);
        writeFileSync(file, typeof review === "string" ? review : JSON.stringify(review));
        responses.push(file);
      }
    },
    env(extra = {}) {
      return {
        ...process.env,
        CODEX_BIN: fakeCodex,
        CODEX_REVIEW_HOME: home,
        CODEX_REVIEW_CONFIG: configPath,
        FAKE_CODEX_RESPONSES: responses.join(","),
        FAKE_CODEX_COUNTER: counter,
        FAKE_CODEX_LOG: log,
        ...extra,
      };
    },
    run(script, input, extraEnv) {
      const result = spawnSync("node", [path.join(hooksDir, script)], {
        input: JSON.stringify({ session_id: context.sessionId, cwd, ...input }),
        env: context.env(extraEnv),
        encoding: "utf8",
      });
      return {
        status: result.status,
        stderr: result.stderr,
        output: result.stdout.trim() ? JSON.parse(result.stdout) : {},
      };
    },
    codexCalls() {
      try {
        return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },
    paths() {
      return ledgerPaths(home, context.sessionId, repo ? cwd : cwd);
    },
    ledger() {
      return loadLedger(context.paths());
    },
    writeDispositions(entries) {
      writeFileSync(context.paths().dispositions, JSON.stringify(entries));
    },
    write(file, content) {
      writeFileSync(path.join(cwd, file), content);
    },
    commitEmpty(message, dir = cwd) {
      execFileSync("git", [
        "-C", dir, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "--allow-empty", "-m", message,
      ]);
    },
    commitAll(message, dir = cwd) {
      execFileSync("git", ["-C", dir, "add", "-A"]);
      execFileSync("git", ["-C", dir, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "-m", message]);
    },
    addWorktree(name) {
      const worktree = path.join(base, name);
      execFileSync("git", ["-C", cwd, "worktree", "add", "-q", "-b", name, worktree]);
      return worktree;
    },
    seedLedger(key, ledger) {
      saveLedger(ledgerPaths(home, context.sessionId, key), ledger);
    },
  };
  return context;
}

const DEFAULT_PLAN = "# Plan\n\nAcceptance criteria: x. Coverage: unit + e2e.";

// The PreToolUse and PostToolUse inputs of one ExitPlanMode call share its tool_use_id.
export function exitPlanMode(plan = DEFAULT_PLAN, toolUseId = "toolu_plan") {
  return { hook_event_name: "PreToolUse", tool_name: "ExitPlanMode", tool_use_id: toolUseId, tool_input: { plan } };
}

export function planApproved(plan = DEFAULT_PLAN, toolUseId = "toolu_plan") {
  return {
    hook_event_name: "PostToolUse",
    tool_name: "ExitPlanMode",
    tool_use_id: toolUseId,
    tool_input: {},
    tool_response: { plan, isAgent: false, filePath: "/home/.claude/plans/plan.md" },
  };
}

export function stop(extra = {}) {
  return { hook_event_name: "Stop", stop_hook_active: false, ...extra };
}
