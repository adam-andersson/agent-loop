import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot, sharedStateKey } from "./git.mjs";

const DEFAULT_CONFIG = fileURLToPath(new URL("../../config.json", import.meta.url));

export function readHookInput() {
  return JSON.parse(readFileSync(0, "utf8"));
}

export function emit(output) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

// One directory per session and repository: linked worktrees share the git common dir, so a plan
// approved in one worktree gates the others, while separate repositories and submodules stay apart.
export function stateDir(sessionId, cwd, env = process.env) {
  const home = env.CODEX_REVIEW_HOME ?? env.CLAUDE_PLUGIN_DATA ?? path.join(homedir(), ".cache", "agent-loop");
  const key = sharedStateKey(cwd) ?? cwd;
  return path.join(home, sessionId, createHash("sha256").update(key).digest("hex").slice(0, 16));
}

export function loadState(dir, loop) {
  try {
    return JSON.parse(readFileSync(path.join(dir, `${loop}.json`), "utf8"));
  } catch {
    return null;
  }
}

export function saveState(dir, loop, state) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${loop}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, file);
}

export function hookContext(input, env = process.env) {
  const config = JSON.parse(readFileSync(env.CODEX_REVIEW_CONFIG ?? DEFAULT_CONFIG, "utf8"));
  const dir = stateDir(input.session_id, input.cwd, env);
  return {
    config,
    root: repoRoot(input.cwd),
    reviews: path.join(dir, "reviews"),
    load: (loop) => loadState(dir, loop),
    save: (loop, state) => saveState(dir, loop, state),
  };
}
