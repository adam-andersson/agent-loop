import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutReview, withReview } from "../scripts/lib/review-block.ts";

const TOKEN = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";
const PLAN = "# Plan\n\nAcceptance criteria: x.";
const start = (token: string) => `<!-- codex-review:${token} -->`;
const end = (token: string) => `<!-- /codex-review:${token} -->`;

test("the review block shows the review after the plan and comes off again", () => {
  const shown = withReview(PLAN, "Codex plan review: approve. Looks sound.", TOKEN);
  assert.ok(shown.startsWith(PLAN));
  assert.match(shown, /## Codex review\n\nCodex plan review: approve\. Looks sound\./);
  assert.equal(withoutReview(shown, TOKEN), PLAN);
});

test("edits made around the block in the dialog are kept", () => {
  const shown = withReview(PLAN, "review", TOKEN);
  const edited = `Note above.\n\n${shown}\n\nAdded criterion: y.`;
  assert.equal(withoutReview(edited, TOKEN), `Note above.\n\n${PLAN}\n\nAdded criterion: y.`);
});

test("a review quoting markers and the heading is removed whole", () => {
  const reason = `## Codex review\n- [blocking] uses ${start("x")} and ${end(OTHER)}`;
  assert.equal(withoutReview(withReview(PLAN, reason, TOKEN), TOKEN), PLAN);
});

test("marker examples in the plan and edits are never mistaken for the block", () => {
  const plan = `# Plan\n\nExample: ${start(OTHER)}\nreview\n${end(OTHER)}\n\nRequirement after the example.`;
  const edited = `${withReview(plan, "review", TOKEN)}\n\nEdit quoting ${start("placeholder")}.`;
  assert.equal(withoutReview(edited, TOKEN), `${plan}\n\nEdit quoting ${start("placeholder")}.`);
});

test("an edited end on the real block leaves the plan as it is, even next to a complete example pair", () => {
  const plan = `# Plan\n\nExample: ${start(OTHER)} x ${end(OTHER)}\n\nRequirement.`;
  const broken = withReview(plan, "review", TOKEN).replace(end(TOKEN), "<!-- /codex-review -->");
  assert.equal(withoutReview(broken, TOKEN), broken);
});

test("a plan with no block, or no token to look for, is unchanged", () => {
  const plan = `${PLAN}\n\n## Codex review\n\nThe user's own section.`;
  assert.equal(withoutReview(plan, TOKEN), plan);
  assert.equal(withoutReview(withReview(PLAN, "review", TOKEN), undefined), withReview(PLAN, "review", TOKEN));
});

test("ambiguous delimiters leave the plan byte for byte unchanged", () => {
  const cases = {
    "duplicate start": `${PLAN}\n${start(TOKEN)}\nkeep\n${start(TOKEN)}\nreview\n${end(TOKEN)}\ntail`,
    "duplicate end": `${PLAN}\n${start(TOKEN)}\nreview\n${end(TOKEN)}\nkeep\n${end(TOKEN)}\ntail`,
    "end before start": `${PLAN}\n${end(TOKEN)}\nkeep\n${start(TOKEN)}\ntail`,
    "missing start": `${PLAN}\nkeep\n${end(TOKEN)}\ntail`,
    "missing end": `${PLAN}\n${start(TOKEN)}\nkeep\ntail`,
  };
  for (const [name, plan] of Object.entries(cases)) assert.equal(withoutReview(plan, TOKEN), plan, name);
});
