import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export function emptyLedger() {
  return {
    nextId: { plan: 1, code: 1 },
    findings: {},
    plan: { rounds: 0, awaitingHuman: null, approved: null },
    code: { active: false, cycleBase: null, lastTree: null, rounds: 0, lastOutcome: null },
    reviews: [],
  };
}

export function ledgerPaths(home, sessionId, repoKey) {
  const repoHash = createHash("sha256").update(repoKey).digest("hex").slice(0, 16);
  const dir = path.join(home, sessionId, repoHash);
  return {
    dir,
    reviews: path.join(dir, "reviews"),
    ledger: path.join(dir, "ledger.json"),
    dispositions: path.join(dir, "dispositions.json"),
  };
}

export function loadLedger(paths) {
  try {
    return JSON.parse(readFileSync(paths.ledger, "utf8"));
  } catch {
    return emptyLedger();
  }
}

export function saveLedger(paths, ledger) {
  mkdirSync(paths.reviews, { recursive: true });
  const temporary = `${paths.ledger}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(temporary, paths.ledger);
}

export function readDispositions(paths) {
  try {
    return readFileSync(paths.dispositions, "utf8");
  } catch {
    return undefined;
  }
}
