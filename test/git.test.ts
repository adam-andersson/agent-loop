import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repoRoot, sharedStateKey, snapshotTree } from "../scripts/lib/git.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function tempRepo() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "git-test-")));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\n");
  writeFileSync(path.join(dir, "tracked.txt"), "one\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

test("repoRoot finds the toplevel from a subdirectory", () => {
  const dir = tempRepo();
  mkdirSync(path.join(dir, "sub"));
  assert.equal(repoRoot(path.join(dir, "sub")), dir);
});

test("sharedStateKey is the main checkout's toplevel from the main checkout and from linked worktrees", () => {
  const dir = tempRepo();
  mkdirSync(path.join(dir, "sub"));
  const worktree = path.join(realpathSync(mkdtempSync(path.join(tmpdir(), "git-worktree-"))), "wt");
  git(dir, "worktree", "add", "-q", "-b", "wt", worktree);
  mkdirSync(path.join(worktree, "nested"));
  for (const cwd of [dir, path.join(dir, "sub"), worktree, path.join(worktree, "nested")]) {
    assert.equal(sharedStateKey(cwd), dir, cwd);
  }
});

test("sharedStateKey is one key for a submodule and its linked worktrees", () => {
  const upstream = tempRepo();
  const superproject = tempRepo();
  git(superproject, "-c", "protocol.file.allow=always", "submodule", "add", "-q", upstream, "mod");
  const submodule = path.join(superproject, "mod");
  const worktree = path.join(realpathSync(mkdtempSync(path.join(tmpdir(), "git-worktree-"))), "wt");
  git(submodule, "worktree", "add", "-q", "-b", "wt", worktree);
  const key = sharedStateKey(submodule);
  assert.ok(key);
  assert.equal(sharedStateKey(worktree), key);
  assert.notEqual(key, sharedStateKey(superproject));
});

test("snapshotTree includes untracked files and excludes ignored ones", () => {
  const dir = tempRepo();
  writeFileSync(path.join(dir, "new.txt"), "untracked\n");
  writeFileSync(path.join(dir, "ignored.txt"), "ignored\n");
  const tree = snapshotTree(dir);
  const files = git(dir, "ls-tree", "-r", "--name-only", tree).split("\n");
  assert.deepEqual(files.sort(), [".gitignore", "new.txt", "tracked.txt"]);
});

test("snapshotTree is stable for an unchanged tree and changes with content", () => {
  const dir = tempRepo();
  const first = snapshotTree(dir);
  assert.equal(snapshotTree(dir), first);
  writeFileSync(path.join(dir, "tracked.txt"), "two\n");
  assert.notEqual(snapshotTree(dir), first);
});

test("snapshotTree sees changes to tracked files that match an ignore rule", () => {
  const dir = tempRepo();
  writeFileSync(path.join(dir, "ignored.txt"), "tracked despite the ignore rule\n");
  git(dir, "add", "-f", "ignored.txt");
  git(dir, "commit", "-q", "-m", "force-add");
  const before = snapshotTree(dir);
  assert.match(git(dir, "ls-tree", "-r", "--name-only", before), /ignored\.txt/);
  writeFileSync(path.join(dir, "ignored.txt"), "edited\n");
  assert.notEqual(snapshotTree(dir), before);
  rmSync(path.join(dir, "ignored.txt"));
  assert.doesNotMatch(git(dir, "ls-tree", "-r", "--name-only", snapshotTree(dir)), /ignored\.txt/);
});

test("snapshotTree sees retargeting of a tracked, ignored, dangling symlink", () => {
  const dir = tempRepo();
  symlinkSync("missing-target-one", path.join(dir, "ignored.txt"));
  git(dir, "add", "-f", "ignored.txt");
  git(dir, "commit", "-q", "-m", "dangling link");
  const before = snapshotTree(dir);
  assert.match(git(dir, "ls-tree", "-r", "--name-only", before), /ignored\.txt/);
  rmSync(path.join(dir, "ignored.txt"));
  symlinkSync("missing-target-two", path.join(dir, "ignored.txt"));
  assert.notEqual(snapshotTree(dir), before);
});

test("snapshotTree leaves HEAD, the index and the working tree status untouched", () => {
  const dir = tempRepo();
  writeFileSync(path.join(dir, "new.txt"), "untracked\n");
  writeFileSync(path.join(dir, "tracked.txt"), "modified\n");
  const head = git(dir, "rev-parse", "HEAD");
  const status = git(dir, "status", "--porcelain");
  snapshotTree(dir);
  assert.equal(git(dir, "rev-parse", "HEAD"), head);
  assert.equal(git(dir, "status", "--porcelain"), status);
  assert.equal(git(dir, "log", "--oneline").split("\n").length, 1);
});

function blob(dir: string, tree: string, file: string): string {
  return git(dir, "rev-parse", `${tree}:${file}`);
}

test("snapshotTree sees edits to assume-unchanged and skip-worktree files, and leaves their flags in the index", () => {
  const dir = tempRepo();
  writeFileSync(path.join(dir, "skipped.txt"), "one\n");
  git(dir, "add", "skipped.txt");
  git(dir, "commit", "-q", "-m", "skipped");
  git(dir, "update-index", "--assume-unchanged", "tracked.txt");
  git(dir, "update-index", "--skip-worktree", "skipped.txt");
  writeFileSync(path.join(dir, "tracked.txt"), "assumed edit\n");
  writeFileSync(path.join(dir, "skipped.txt"), "skipped edit\n");
  const flags = git(dir, "ls-files", "-v");
  const tree = snapshotTree(dir);
  assert.equal(blob(dir, tree, "tracked.txt"), git(dir, "hash-object", "tracked.txt"));
  assert.equal(blob(dir, tree, "skipped.txt"), git(dir, "hash-object", "skipped.txt"));
  assert.equal(git(dir, "ls-files", "-v"), flags);
});

test("snapshotTree sees a same-size edit made within the index's racy window", () => {
  const dir = tempRepo();
  // Compare only mtime seconds and size, so the edit below is invisible to the stat check alone.
  git(dir, "config", "core.checkStat", "minimal");
  git(dir, "config", "core.trustctime", "false");
  const file = path.join(dir, "tracked.txt");
  const time = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
  utimesSync(file, time, time);
  git(dir, "add", "tracked.txt");
  utimesSync(path.join(dir, ".git", "index"), time, time);
  writeFileSync(file, "two\n");
  utimesSync(file, time, time);
  assert.equal(blob(dir, snapshotTree(dir), "tracked.txt"), git(dir, "hash-object", "tracked.txt"));
});

test("snapshotTree works in a repository with no commits and no index", () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "git-test-")));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "new.txt"), "untracked\n");
  assert.equal(git(dir, "ls-tree", "-r", "--name-only", snapshotTree(dir)), "new.txt");
});

test("snapshotTree on a split index adds and removes no shared index, and leaves the real index readable", () => {
  const dir = tempRepo();
  git(dir, "config", "core.splitIndex", "true");
  git(dir, "config", "splitIndex.maxPercentChange", "0");
  git(dir, "config", "splitIndex.sharedIndexExpire", "now");
  writeFileSync(path.join(dir, "staged.txt"), "staged\n");
  git(dir, "add", "staged.txt");
  writeFileSync(path.join(dir, "tracked.txt"), "unstaged edit\n");
  const shared = () => readdirSync(path.join(dir, ".git")).filter((name) => name.startsWith("sharedindex.")).sort();
  const before = shared();
  assert.ok(before.length > 0);
  const staged = git(dir, "ls-files", "-s");
  const tree = snapshotTree(dir);
  assert.equal(blob(dir, tree, "tracked.txt"), git(dir, "hash-object", "tracked.txt"));
  assert.deepEqual(shared(), before);
  assert.equal(git(dir, "ls-files", "-s"), staged);
});

test("snapshotTree keeps a tracked executable's mode when core.filemode=false comes from the inherited environment", () => {
  const dir = tempRepo();
  const script = path.join(dir, "run.sh");
  writeFileSync(script, "#!/bin/sh\n");
  chmodSync(script, 0o755);
  git(dir, "add", "run.sh");
  git(dir, "commit", "-q", "-m", "executable");
  chmodSync(script, 0o644);
  const inherited = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.filemode", GIT_CONFIG_VALUE_0: "false" };
  Object.assign(process.env, inherited);
  try {
    assert.match(git(dir, "ls-tree", snapshotTree(dir), "run.sh"), /^100755 /);
  } finally {
    for (const key of Object.keys(inherited)) delete process.env[key];
  }
});

test("snapshotTree of an unedited sparse checkout is HEAD's tree, out-of-cone files included", () => {
  const dir = tempRepo();
  for (const sub of ["kept", "sparse"]) {
    mkdirSync(path.join(dir, sub));
    writeFileSync(path.join(dir, sub, "file.txt"), `${sub}\n`);
  }
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "two directories");
  git(dir, "sparse-checkout", "set", "kept");
  assert.equal(snapshotTree(dir), git(dir, "rev-parse", "HEAD^{tree}"));
});
