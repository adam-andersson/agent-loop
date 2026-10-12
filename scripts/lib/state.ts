import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { repoRoot, sharedStateKey } from "./git.ts";
import type { HookInput, LoopState } from "./types.ts";

export function readHookInput(): HookInput {
  return JSON.parse(readFileSync(0, "utf8"));
}

export function emit(output: object): void {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

// One directory per session and repository: linked worktrees share the git common dir, so a plan
// approved in one worktree gates the others, while separate repositories and submodules stay apart.
export function stateDir(sessionId: string, cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.CLAUDE_PLUGIN_DATA ?? path.join(homedir(), ".cache", "agent-loop");
  const key = sharedStateKey(cwd) ?? cwd;
  return path.join(home, sessionId, createHash("sha256").update(key).digest("hex").slice(0, 16));
}

export function loadState<L extends keyof LoopState>(dir: string, loop: L): LoopState[L] | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, `${loop}.json`), "utf8"));
  } catch {
    return null;
  }
}

export function saveState<L extends keyof LoopState>(dir: string, loop: L, state: LoopState[L]): void {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${loop}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, file);
}

export function hookContext(input: HookInput, env: NodeJS.ProcessEnv = process.env) {
  const dir = stateDir(input.session_id, input.cwd, env);
  return {
    root: repoRoot(input.cwd),
    reviews: path.join(dir, "reviews"),
    load: <L extends keyof LoopState>(loop: L) => loadState(dir, loop),
    save: <L extends keyof LoopState>(loop: L, state: LoopState[L]) => saveState(dir, loop, state),
  };
}
