import { snapshotTree } from "./lib/git.mjs";
import { saveLedger } from "./lib/ledger.mjs";
import { acknowledgeHandOffs, hookContext, readHookInput } from "./lib/runtime.mjs";

const input = readHookInput();
const { root, paths, ledger } = hookContext(input);

// The user saw these findings in this call's dialog and approved anyway. A hand-off recorded for
// another call (e.g. left behind by a retry whose hook failed) supersedes nothing.
const handOff = ledger.plan.awaitingHuman;
if (input.tool_use_id && handOff?.toolUseId === input.tool_use_id) {
  for (const id of handOff.shownFindings ?? []) {
    const finding = ledger.findings[id];
    if (finding?.phase === "plan" && finding.status === "open") finding.status = "superseded";
  }
}

ledger.plan.awaitingHuman = null;
ledger.plan.rounds = 0;
ledger.plan.approved = {
  text: input.tool_response?.plan ?? input.tool_input?.plan ?? "",
  at: new Date().toISOString(),
};
acknowledgeHandOffs(ledger);

if (root) {
  const tree = snapshotTree(root);
  ledger.code = {
    active: true,
    cycleBase: tree,
    lastTree: tree,
    rounds: 0,
    lastOutcome: null,
    escalated: false,
    escalatedAtHead: null,
    stalled: false,
  };
}

saveLedger(paths, ledger);
