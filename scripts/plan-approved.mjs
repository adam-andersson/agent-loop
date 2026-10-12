import { snapshotTree } from "./lib/git.mjs";
import { hookContext, readHookInput } from "./lib/state.mjs";

// The one link between the loops: the approved plan, and the tree its first section starts from.
const input = readHookInput();
const { root, save } = hookContext(input);
save("plan", { round: 0, lastReport: null });
if (root) {
  save("code", {
    // tool_response carries the plan as approved, including edits made in the dialog.
    plan: input.tool_response?.plan ?? input.tool_input?.plan ?? "",
    base: snapshotTree(root),
    round: 0,
    lastTree: null,
    lastOutcome: null,
    lastReport: null,
    lastReportPath: null,
  });
}
