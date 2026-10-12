import { snapshotTree } from "./lib/git.mjs";
import { hookContext, readHookInput } from "./lib/state.mjs";

// The one link between the loops: the approved plan, and the tree its section starts from.
const input = readHookInput();
const { root, load, save } = hookContext(input);
save("plan", { round: 0, lastReport: null });
if (root) {
  const code = load("code");
  // A revised plan keeps the section base, so edits not yet reviewed stay in review. After the
  // round cap, approval accepts the capped review the user saw, but only up to the tree it covered.
  const base = !code ? snapshotTree(root) : code.lastOutcome === "escalate" ? code.lastTree : code.base;
  save("code", {
    // tool_response carries the plan as approved, including edits made in the dialog.
    plan: input.tool_response?.plan ?? input.tool_input?.plan ?? "",
    base,
    round: 0,
    lastTree: null,
    lastOutcome: null,
    lastReport: null,
    lastReportPath: null,
  });
}
