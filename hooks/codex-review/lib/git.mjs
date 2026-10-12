import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function repoRoot(cwd) {
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
export function sharedStateKey(cwd) {
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

function revParse(root, revision) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--verify", "--quiet", revision], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function headCommit(root) {
  return revParse(root, "HEAD");
}

export function headTree(root) {
  return revParse(root, "HEAD^{tree}");
}

function entryExists(file) {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

export function snapshotTree(root) {
  const scratch = mkdtempSync(path.join(tmpdir(), "codex-review-index-"));
  const index = path.join(scratch, "index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    const tracked = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached"], { encoding: "utf8" })
      .split("\0")
      .filter((file) => file && entryExists(path.join(root, file)));
    execFileSync("git", ["-C", root, "add", "-A"], { env, stdio: "ignore" });
    if (tracked.length > 0) {
      execFileSync("git", ["-C", root, "add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"], {
        env,
        input: tracked.join("\0"),
        stdio: ["pipe", "ignore", "ignore"],
      });
    }
    return execFileSync("git", ["-C", root, "write-tree"], { env, encoding: "utf8" }).trim();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
