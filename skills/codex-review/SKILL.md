---
name: codex-review
description: Triage Codex review findings returned by the plan or code review hooks — verify each finding, record a disposition, fix accepted ones test-first. Use whenever an ExitPlanMode denial or a Stop block carries Codex findings, or when the user asks how a Codex review was handled.
---

# Triage Codex findings

The hook's message lists findings by id (`P1`… for the plan, `C1`… for code) and the path of `dispositions.json`. Codex sees your dispositions next round as claims it will verify; they never close a finding. Only Codex closes findings, in `ledger.json`, which you must never edit.

## For every finding

1. **Verify before deciding.** Reproduce layout or behaviour claims with a throwaway probe test; check code claims by reading the code and running what you can. Many review findings are false positives from reading code alone.
2. **Decide one disposition:**
   - `accepted` — it is real. Evidence: what you verified and what you changed.
   - `rejected` — it is wrong. Evidence: concrete proof (file:line, command output, a test). A rejection backed by evidence is a valid outcome; never bend the code just to make a finding go away. If Codex keeps a rejected finding open, it goes to the user.
   - `needs-human` — it hinges on a product or design choice only the user can make. This hands the review to the user.
3. **Write all dispositions** to the `dispositions.json` path from the hook message, as a JSON array: `[{ "id": "C1", "disposition": "accepted", "evidence": "..." }]`. Include earlier entries that still apply.

## Fixing an accepted finding

- For behaviour, write a failing test that captures the finding first, then fix.
- Fix the pattern, not the line: state the underlying bug in one sentence, search the surrounding component for the same pattern, and fix every instance.
- If Codex needs an external source to verify something (docs, an issue), save it as a local file and cite the path; Codex has no network.

## Then

Call `ExitPlanMode` again (plan) or finish and stop again (code). Tell the user briefly which findings you accepted, rejected or escalated.
