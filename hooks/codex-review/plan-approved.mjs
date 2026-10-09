import { snapshotTree } from "./lib/git.mjs";
import { saveLedger } from "./lib/ledger.mjs";
import { acknowledgeHandOffs, hookContext, readHookInput } from "./lib/runtime.mjs";

const input = readHookInput();
const { root, paths, ledger } = hookContext(input);

ledger.plan.awaitingHuman = null;
ledger.plan.rounds = 0;
ledger.plan.approved = { text: input.tool_input?.plan ?? "", at: new Date().toISOString() };
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
