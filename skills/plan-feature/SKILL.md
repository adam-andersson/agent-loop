---
name: plan-feature
description: Plan a non-trivial feature or fix for Codex plan review and user approval, with acceptance criteria, expected test coverage and sections. Use when the user asks to build, implement or fix something non-trivial.
---

# Plan a feature

Codex reviews the plan when you call `ExitPlanMode`, and the user approves it after that.

## 1. Explore

Enter plan mode and read the code and docs the change touches. Exploration is done when you can name the files, interfaces and existing helpers the change involves.

## 2. Write the plan

A reviewable plan contains:

- **Context**: the problem, and the outcome the change should produce.
- **Acceptance criteria**: observable behaviour that proves the change works.
- **Expected test coverage**: which acceptance (end-to-end) and unit tests, and where they live. A visual-only change says how it is measured instead.
- **Sections**: small steps, each ending green and reviewable on its own.
- **Breaking changes** to public APIs, schemas or state formats, called out.

The plan is done when every acceptance criterion has a test that would fail without the change.

## 3. Review and approval

Print the full plan in your message, then call `ExitPlanMode`.

- **Denied with findings**: triage them with the `agent-loop:codex-review` skill, revise the plan, and call `ExitPlanMode` again.
- **Approval dialog**: the user sees the plan with Codex's review appended, and decides. Approving it there records the plan and the section base, which turns on code review.

A plan is approved only through a successful `ExitPlanMode` call. If the user approves in chat instead, call `ExitPlanMode` again so they can approve it in the dialog. Then implement the plan with the `agent-loop:implement-plan` skill.
