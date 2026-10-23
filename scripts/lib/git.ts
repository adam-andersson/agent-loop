import { execFileSync } from "node:child_process";
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function repoRoot(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

// One key for every worktree of a repository: git's own main-worktree path, the common dir
// with a trailing /.git stripped. For a plain repo that is the main checkout's toplevel; for a
// submodule it is <super>/.git/modules/<name>, which is fine since it is only a key.
export function sharedStateKey(cwd: string): string | undefined {
  try {
    const common = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const real = realpathSync(common);
    return path.basename(real) === ".git" ? path.dirname(real) : real;
  } catch {
    return undefined;
  }
}

// Bytes and timestamps come from one descriptor: git replaces the index by rename, and newer
// timestamps on older bytes would let an entry git must re-check pass as clean.
function copyIndex(from: string, to: string): void {
  let fd: number;
  try {
    fd = openSync(from, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  try {
    const { atime, mtime } = fstatSync(fd);
    writeFileSync(to, readFileSync(fd));
    utimesSync(to, atime, mtime);
  } finally {
    closeSync(fd);
  }
}

// Git's own view of the working tree, untracked files included: built in a copy of the real
// index, so only changed files are re-read, and the real index is never written.
export function snapshotTree(root: string): string {
  const scratch = mkdtempSync(path.join(tmpdir(), "codex-review-index-"));
  const index = path.join(scratch, "index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  // A split index would write and expire shared index files in the real git directory. Git's
  // warnings stay out of the hook's stderr, and reach the error message if a command fails.
  const git = (args: string[], input?: string) =>
    execFileSync("git", ["-C", root, "-c", "core.splitIndex=false", ...args], { env, input, encoding: "utf8", stdio: "pipe" });
  try {
    // Without the temporary GIT_INDEX_FILE, which --git-path would echo back.
    copyIndex(path.resolve(root, execFileSync("git", ["-C", root, "rev-parse", "--git-path", "index"], { encoding: "utf8" }).trim()), index);
    // Flagged entries would hide Claude's edits from add -A. ls-files -v tags assume-unchanged
    // entries in lowercase and skip-worktree ones with S; update-index takes one such flag per call.
    const entries = git(["ls-files", "-v", "-z"]).split("\0");
    const assumed = entries.filter((entry) => /^[a-z] /.test(entry)).map((entry) => entry.slice(2));
    const skipped = entries.filter((entry) => /^[sS] /.test(entry)).map((entry) => entry.slice(2));
    if (assumed.length > 0) git(["update-index", "--no-assume-unchanged", "-z", "--stdin"], assumed.join("\0"));
    if (skipped.length > 0) git(["update-index", "--no-skip-worktree", "-z", "--stdin"], skipped.join("\0"));
    git(["add", "-A"]);
    return git(["write-tree"]).trim();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
