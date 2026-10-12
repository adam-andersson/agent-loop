import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyLedger, ledgerPaths, loadLedger, readDispositions, saveLedger } from "../scripts/lib/ledger.mjs";

function home() {
  return mkdtempSync(path.join(tmpdir(), "ledger-test-"));
}

test("ledgerPaths separates sessions and repositories", () => {
  const root = home();
  const a = ledgerPaths(root, "session-1", "/repo/a");
  assert.notEqual(a.dir, ledgerPaths(root, "session-1", "/repo/b").dir);
  assert.notEqual(a.dir, ledgerPaths(root, "session-2", "/repo/a").dir);
  assert.equal(path.basename(a.ledger), "ledger.json");
  assert.equal(path.basename(a.dispositions), "dispositions.json");
  assert.equal(path.dirname(a.ledger), path.dirname(a.dispositions));
});

test("loadLedger returns an empty ledger before anything is saved", () => {
  const paths = ledgerPaths(home(), "s", "/repo");
  assert.deepEqual(loadLedger(paths), emptyLedger());
});

test("saveLedger round-trips and creates the directory", () => {
  const paths = ledgerPaths(home(), "s", "/repo");
  const ledger = { ...emptyLedger(), code: { ...emptyLedger().code, active: true } };
  saveLedger(paths, ledger);
  assert.equal(existsSync(paths.ledger), true);
  assert.deepEqual(loadLedger(paths), ledger);
});

test("readDispositions returns undefined when Opus has written none", () => {
  assert.equal(readDispositions(ledgerPaths(home(), "s", "/repo")), undefined);
});

test("readDispositions returns the raw file text", () => {
  const paths = ledgerPaths(home(), "s", "/repo");
  saveLedger(paths, emptyLedger());
  writeFileSync(paths.dispositions, "[]");
  assert.equal(readDispositions(paths), "[]");
  assert.equal(readFileSync(paths.ledger, "utf8").includes("dispositions"), false);
});
