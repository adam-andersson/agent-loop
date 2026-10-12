---
name: implement-plan
description: Implement an approved plan section by section with outside-in TDD, under Codex code review at each stop. Use once the user has approved a plan.
---

# Implement an approved plan

Start once the user has approved the plan in the `ExitPlanMode` dialog: that approval records the plan and the section base. From then on, each stop with changes starts a Codex review of the section: everything changed since the section started, against the approved plan.

## Each section: outside-in TDD

1. Write the section's acceptance test and watch it go red for the reason the plan names.
2. Write the next unit test, watch it go red, then write the least code that turns it green.
3. Refactor while green, then run the acceptance test; loop back to 2 until it is green.
4. If the acceptance test is still red after three inner loops, hand the diagnosis to `codex:rescue`.

Mock only at module boundaries, and give every test a way to go red.

## End of section

1. Run the repository's checks, as its `AGENTS.md` or `CLAUDE.md` defines them.
2. Stop with a summary: what changed, which checks ran and their results, and what you could not verify. The code review runs on this stop. If it blocks with findings, triage them with the `agent-loop:codex-review` skill and stop again.
3. Hand the section to the user, following the repository's commit conventions, and start the next section once they have taken it.
