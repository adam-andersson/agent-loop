// The plan approval dialog shows only the plan, so the plan hook appends the review to it, and
// the approval hook takes it off again before recording the plan. The token is fresh per block
// and kept in the plan state, so only the block the hook generated can ever be removed.
const SEPARATOR = "\n\n";
const start = (token: string) => `<!-- codex-review:${token} -->`;
const end = (token: string) => `<!-- /codex-review:${token} -->`;

export function withReview(plan: string, reason: string, token: string): string {
  return `${plan}${SEPARATOR}${start(token)}\n## Codex review\n\n${reason}\n${end(token)}`;
}

// Removes the block only when its start and end each appear exactly once, in order; anything
// else means the user edited it, and guessing could delete requirements, so the plan is kept.
export function withoutReview(plan: string, token: string | undefined): string {
  if (!token) return plan;
  const [open, close] = [start(token), end(token)];
  const from = plan.indexOf(open);
  const to = plan.indexOf(close);
  if (from < 0 || to < from || plan.lastIndexOf(open) !== from || plan.lastIndexOf(close) !== to) return plan;
  const before = plan.slice(0, from);
  return (before.endsWith(SEPARATOR) ? before.slice(0, -SEPARATOR.length) : before) + plan.slice(to + close.length);
}
