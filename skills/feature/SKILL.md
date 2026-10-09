---
name: feature
description: Build a feature or fix end to end with the reviewed loop — worktree, a plan with acceptance criteria and test coverage, Codex plan review, user approval, outside-in TDD per section, Codex code review, and a draft commit message per section. Use when the user asks to build, implement or fix something non-trivial.
---

# Feature loop

Hooks run Codex (read-only) at two points: when you call `ExitPlanMode`, and when you stop after an approved plan with changes in the tree. You don't call Codex yourself; you respond to what the hooks return, using the `codex-review` skill.

## 1. Worktree first

Start in a fresh worktree before reading code: `EnterWorktree` (`name: <short-kebab-description>`), then `git branch -m <type>/<short-kebab-description>` with a conventional-commit type.

## 2. Plan

Enter plan mode, read the relevant code and docs, and write a plan that contains:

- **Acceptance criteria**: observable behaviour that proves the change works.
- **Expected test coverage**: which acceptance (e2e) tests and which unit tests, and where they live. Visual-only changes say how they are measured instead.
- **Commit sections**: small steps, each ending green and reviewable on its own.
- Any public API break, called out explicitly.

When you call `ExitPlanMode`, the plan gate reviews the plan. A deny carries Codex's findings: triage them with the `codex-review` skill, revise, and call `ExitPlanMode` again.

**Presenting the plan.** Before every `ExitPlanMode` call, print the full final plan in your message, followed by a short Codex review summary. A review summary never replaces the plan. Only an explicit approval from the user counts: a tool result saying "approved" is not one unless the user saw the dialog, so if in doubt, ask in chat before writing code.

## 3. Each section: outside-in TDD

1. Write the acceptance test for the section and watch it fail for the right reason.
2. Write the next unit test, watch it fail, then write the least code that passes it.
3. Refactor with the tests green, then run the acceptance test; loop back to 2 until it passes.
4. If the acceptance test is still red after three inner loops, hand the diagnosis to `codex:rescue` instead of guessing further.

Mock only at module boundaries. A test that cannot fail is not coverage.

## 4. End of section

1. Run the repository's definition of done (its `AGENTS.md`).
2. Stop with a summary and a draft commit message (why in the body; no hard wrapping). The code gate reviews the section when you stop; if it blocks, triage with the `codex-review` skill, fix, and stop again.
3. Never commit. Wait for the user to commit before starting the next section.
