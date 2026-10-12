import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDispositions } from "./decide.mjs";
import { repoRoot, sharedStateKey } from "./git.mjs";
import { ledgerPaths, loadLedger, readDispositions } from "./ledger.mjs";

const DEFAULT_CONFIG = fileURLToPath(new URL("../config.json", import.meta.url));

export function readHookInput() {
  return JSON.parse(readFileSync(0, "utf8"));
}

export function hookContext(input, env = process.env) {
  const config = JSON.parse(readFileSync(env.CODEX_REVIEW_CONFIG ?? DEFAULT_CONFIG, "utf8"));
  const root = repoRoot(input.cwd);
  const home = env.CODEX_REVIEW_HOME ?? path.join(homedir(), ".cache", "claude-codex-review");
  const stateRoot = resolveStateRoot(home, input.session_id, root, input.cwd);
  const paths = ledgerPaths(home, input.session_id, stateRoot);
  const ledger = loadLedger(paths);
  const { dispositions, ignored } = parseDispositions(readDispositions(paths), Object.keys(ledger.findings));
  return { config, root, stateRoot, paths, ledger, dispositions, ignored };
}

// State used to be keyed on the checkout's own toplevel; a ledger already there wins, so state
// written under that key is still found. New state is shared by all worktrees of the repository.
function resolveStateRoot(home, sessionId, root, cwd) {
  if (!root) return cwd;
  if (existsSync(ledgerPaths(home, sessionId, root).ledger)) return root;
  return sharedStateKey(cwd) ?? root;
}

export function openFindings(ledger, phase) {
  return Object.values(ledger.findings).filter((finding) => finding.phase === phase && finding.status === "open");
}

function acknowledgementKey(disposition) {
  return `${disposition.id}:${createHash("sha256").update(disposition.evidence).digest("hex").slice(0, 16)}`;
}

export function needsHuman(ledger, phase, dispositions) {
  const acknowledged = new Set(ledger.acknowledged ?? []);
  return openFindings(ledger, phase).filter((finding) => {
    const disposition = dispositions[finding.id];
    return disposition?.disposition === "needs-human" && !acknowledged.has(acknowledgementKey(disposition));
  });
}

export function decisionDispositions(ledger, dispositions) {
  const acknowledged = new Set(ledger.acknowledged ?? []);
  return Object.fromEntries(
    Object.entries(dispositions).filter(
      ([, disposition]) => !(disposition.disposition === "needs-human" && acknowledged.has(acknowledgementKey(disposition)))
    )
  );
}

export function recordHandOff(ledger, waiting, dispositions) {
  ledger.handedOff = [
    ...(ledger.handedOff ?? []),
    ...waiting.map((finding) => acknowledgementKey(dispositions[finding.id])),
  ];
}

export function acknowledgeHandOffs(ledger) {
  ledger.acknowledged = [...(ledger.acknowledged ?? []), ...(ledger.handedOff ?? [])];
  ledger.handedOff = [];
}

export function formatFinding(finding) {
  return `- ${finding.id} [${finding.severity}, ${finding.confidence}] ${finding.area}: ${finding.claim}\n  Evidence: ${finding.evidence}\n  Recommendation: ${finding.recommendation}`;
}

export function triageInstructions(paths, ignored) {
  const notes = ignored.length > 0 ? `\nIgnored from your last dispositions.json: ${ignored.join("; ")}.` : "";
  return `Triage with the codex-review skill: verify each finding first, then write ${paths.dispositions} as a JSON array of {"id", "disposition": "accepted" | "rejected" | "needs-human", "evidence"}. Fix what you accept (a failing test first for behaviour). Do not edit ledger.json.${notes}`;
}

export function emit(output) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
