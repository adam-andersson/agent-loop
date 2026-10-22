import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadState, stateDir } from "../scripts/lib/state.ts";
import type { Config, Finding, LoopState, Review } from "../scripts/lib/types.ts";

export const pluginRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptsDir = path.join(pluginRoot, "scripts");
const fakeCodex = fileURLToPath(new URL("fixtures/fake-codex.ts", import.meta.url));

// Hook output is loosely typed on purpose: tests assert on whatever the hook emitted.
export type HookResult = { status: number | null; stderr: string; output: any };
type Env = Record<string, string>;

export function blockingFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: "blocking",
    claim: "the bug",
    evidence: "src/a.ts:1 shows it",
    recommendation: "fix it",
    ...overrides,
  };
}

export function reviewJson(overrides: Partial<Review> = {}): Review {
  return {
    summary: "summary",
    files_inspected: ["src/a.ts"],
    findings: [],
    ...overrides,
  };
}

export function revise(...findings: Finding[]): Review {
  return reviewJson({ findings: findings.length > 0 ? findings : [blockingFinding()] });
}

export function setup({ repo = true, config = {} }: { repo?: boolean; config?: Partial<Config> } = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "hooks-test-")));
  const home = path.join(base, "home");
  const cwd = path.join(base, "repo");
  execFileSync("mkdir", ["-p", cwd, home]);
  if (repo) {
    execFileSync("git", ["-C", cwd, "init", "-q", "-b", "main"]);
    writeFileSync(path.join(cwd, "a.txt"), "one\n");
  }
  const options: Env = Object.fromEntries(
    Object.entries({ timeoutSec: 5, ...config }).map(([key, value]) => [`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`, String(value)])
  );
  const responses: string[] = [];
  const counter = path.join(base, "counter");
  const log = path.join(base, "codex-log.jsonl");

  const context = {
    base,
    home,
    cwd,
    sessionId: "session-1",
    respondWith(...reviews: (Review | string)[]) {
      for (const review of reviews) {
        const file = path.join(base, `response-${responses.length}.json`);
        writeFileSync(file, typeof review === "string" ? review : JSON.stringify(review));
        responses.push(file);
      }
    },
    // Options inherited from a Claude Code session are dropped, so each test sees only its own.
    env(extra: Env = {}): NodeJS.ProcessEnv {
      const inherited = Object.entries(process.env).filter(([key]) => !key.startsWith("CLAUDE_PLUGIN_OPTION_"));
      return {
        ...Object.fromEntries(inherited),
        CODEX_BIN: fakeCodex,
        CLAUDE_PLUGIN_DATA: home,
        FAKE_CODEX_RESPONSES: responses.join(","),
        FAKE_CODEX_COUNTER: counter,
        FAKE_CODEX_LOG: log,
        ...extra,
      };
    },
    run(script: string, input: object, extraEnv?: Env): HookResult {
      return context.runCommand("node", [path.join(scriptsDir, script)], input, { ...options, ...extraEnv });
    },
    // Runs a hooks.json command the way Claude Code does: through a shell, with the plugin root set.
    // No option is set, so the hook runs on the manifest's defaults.
    runRegistered(command: string, input: object): HookResult {
      return context.runCommand("sh", ["-c", command], input, { CLAUDE_PLUGIN_ROOT: pluginRoot });
    },
    runCommand(file: string, args: string[], input: object, extraEnv?: Env): HookResult {
      const result = spawnSync(file, args, {
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
    codexCalls(): { args: string[]; stdin: string }[] {
      try {
        return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },
    // The state a loop keeps for the repository that dir belongs to. Tests read it only once a
    // hook has written it.
    state<L extends keyof LoopState>(loop: L, dir = cwd): LoopState[L] {
      return loadState(stateDir(context.sessionId, dir, { CLAUDE_PLUGIN_DATA: home }), loop)!;
    },
    write(file: string, content: string) {
      writeFileSync(path.join(cwd, file), content);
    },
    commitAll(message: string, dir = cwd) {
      execFileSync("git", ["-C", dir, "add", "-A"]);
      execFileSync("git", ["-C", dir, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "-m", message]);
    },
    addWorktree(name: string) {
      const worktree = path.join(base, name);
      execFileSync("git", ["-C", cwd, "worktree", "add", "-q", "-b", name, worktree]);
      return worktree;
    },
  };
  return context;
}

const DEFAULT_PLAN = "# Plan\n\nAcceptance criteria: x. Coverage: unit + e2e.";

export function exitPlanMode(plan = DEFAULT_PLAN) {
  return { hook_event_name: "PreToolUse", tool_name: "ExitPlanMode", tool_input: { plan } };
}

export function planApproved(plan = DEFAULT_PLAN) {
  return {
    hook_event_name: "PostToolUse",
    tool_name: "ExitPlanMode",
    tool_input: {},
    tool_response: { plan, isAgent: false, filePath: "/home/.claude/plans/plan.md" },
  };
}

export function stop(extra: object = {}) {
  return { hook_event_name: "Stop", stop_hook_active: false, ...extra };
}
