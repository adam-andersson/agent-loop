import { snapshotTree } from "./lib/git.ts";
import { withoutReview } from "./lib/review-block.ts";
import { hookContext, readHookInput } from "./lib/state.ts";

// The one link between the loops: the approved plan, and the tree its section starts from.
const input = readHookInput();
const { root, load, save } = hookContext(input);
const reviewToken = load("plan")?.reviewToken;
save("plan", { round: 0, lastReport: null });
if (root) {
  const code = load("code");
  // A revised plan keeps the section base, so edits not yet reviewed stay in review. Only a pass
  // moves the base: approving a plan after the round cap does not accept the open blockers.
  const base = code ? code.base : snapshotTree(root);
  save("code", {
    // tool_response carries the plan as approved, including edits made in the dialog; the review
    // the plan hook appended for the dialog is not part of it.
    plan: withoutReview(input.tool_response?.plan ?? input.tool_input?.plan ?? "", reviewToken),
    base,
    round: 0,
    lastTree: null,
    lastOutcome: null,
    lastReport: null,
    lastReportPath: null,
  });
}
