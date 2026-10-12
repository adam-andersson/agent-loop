---
name: codex-review
description: Triage Codex review findings from the plan or code review hooks. Use when an ExitPlanMode denial or a Stop block carries Codex findings, or when the user asks how a Codex review was handled.
---

# Triage Codex findings

The hook's message lists Codex's findings, each with a severity, claim, evidence and recommendation. The next round is a fresh Codex review of the whole plan or section, with its previous report and your reply as context. A blocking finding is gone only when Codex no longer reports it.

## For every finding

1. **Verify it.** Reproduce a behaviour claim with a throwaway probe test; check a code claim by reading the code and running what you can. Review findings read from code alone are often wrong.
2. **Decide:**
   - **Holds up:** fix it. For behaviour, write a failing test that captures the finding first. Fix the pattern, not the line: state the underlying bug in one sentence, then fix every instance in the surrounding code.
   - **Wrong:** leave the code as it is, and give the proof: file:line, command output or a test.
   - **Needs a product or design call:** leave it for the user, and say what the choice is.
3. **Answer it in your reply**, one line per finding: its claim in a few words, your decision, and the evidence. Codex reads this reply next round as claims to check.

Triage is done when every finding has its line in the reply.

## Then

- **Plan:** revise the plan and call `ExitPlanMode` again.
- **Code:** stop again. A changed tree starts the next round. A stop with nothing changed lets you through, and tells the user which blockers are still open.

When the round cap is reached, the user decides with the open findings in front of them.
