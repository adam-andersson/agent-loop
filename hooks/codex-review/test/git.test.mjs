import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { headCommit, headTree, repoRoot, snapshotTree } from "../lib/git.mjs";

function git(cwd, ...args) {
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

test("repoRoot is undefined outside a git repository", () => {
  assert.equal(repoRoot(realpathSync(mkdtempSync(path.join(tmpdir(), "no-git-")))), undefined);
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

test("headCommit is the HEAD commit and null before the first commit", () => {
  const dir = tempRepo();
  assert.equal(headCommit(dir), git(dir, "rev-parse", "HEAD"));
  const empty = realpathSync(mkdtempSync(path.join(tmpdir(), "git-empty-")));
  git(empty, "init", "-q");
  assert.equal(headCommit(empty), null);
});

test("headTree is the committed tree and null before the first commit", () => {
  const dir = tempRepo();
  assert.equal(headTree(dir), git(dir, "rev-parse", "HEAD^{tree}"));
  const empty = realpathSync(mkdtempSync(path.join(tmpdir(), "git-empty-")));
  git(empty, "init", "-q");
  assert.equal(headTree(empty), null);
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
