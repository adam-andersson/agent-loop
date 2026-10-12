# agent-loop

A Claude Code plugin in which Codex reviews Claude's plans and code, as two separate loops with Claude triaging the findings.

## Plan loop

```
Claude calls ExitPlanMode ──► Codex reviews the plan
   ▲                            │ blocking findings, under the round cap → deny: Claude triages and revises
   └────────────────────────────┘ otherwise → the approval dialog, with the review appended: the user decides
```

## Code loop

```
User approves the plan ──► records the plan and the tree as the section base
Claude stops with changes ──► Codex reviews the whole section (base..now) against the plan
   ▲                            │ blocking findings, under the round cap → block: Claude triages, fixes, stops again
   └────────────────────────────┘ pass → notice, the base moves on; cap reached → notice, the user decides
```

Each round is a fresh review of the current plan or section, with Codex's previous report and Claude's reply as context, so a blocker Codex no longer reports is fixed. At the round cap the code loop keeps the section base, so later rounds still cover the unresolved section until a pass or a new plan approval. A stop with nothing changed since a block goes through with a notice; Claude Code's own cap on consecutive Stop blocks is the outer guard.

## Design choices

- **Hooks are the gates**, so a review cannot be skipped or paraphrased. Only blocking findings block: a reviewer asked to find gaps always finds some ([Claude Code best practices](https://code.claude.com/docs/en/best-practices)).
- **A different model reviews**, in a fresh context, since a model judging its own output favours it ([Panickssery et al., 2024](https://arxiv.org/abs/2404.13076)). Claude verifies each finding before acting on it, and Codex checks Claude's reply against the code rather than ruling on it as an argument.
- **Codex runs read-only**, with an explicit model, the prompt on stdin and a JSON schema (`schemas/review.json`). A failed, empty or malformed run is "NOT reviewed", never a pass.
- **The prompts** (`prompts/`) follow the Codex plugin's adversarial review: one template per loop, shared rules, and the plan, report and reply last as untrusted material that is never closed.
- **State** is one small file per loop in `${CLAUDE_PLUGIN_DATA}/<session>/<repository>/`. Worktrees of a repository share it, so a plan approved in one gates the others; separate repositories and submodules stay apart. Snapshots are git tree objects, untracked files included; nothing is committed.

## Skills

- `plan-feature`: what a reviewable plan contains, and how the plan review and approval go.
- `implement-plan`: outside-in TDD per section, under code review at each stop.
- `codex-review`: triage of Codex's findings.

## Install

Install the plugin from this repository, which is its own marketplace:

```
/plugin marketplace add ~/dev/agent-loop
/plugin install agent-loop@agent-loop
```

Keep the Codex plugin's own stop review gate disabled. To try local changes without installing, start Claude Code with `claude --plugin-dir ~/dev/agent-loop`.

`codex/AGENTS.md` holds personal working agreements for Claude Code and Codex, outside the plugin. To use them, link them for Codex and import them in `~/.claude/CLAUDE.md` with `@~/.codex/AGENTS.md`:

```bash
ln -s ~/dev/agent-loop/codex/AGENTS.md ~/.codex/AGENTS.md
```

### Migrating from the symlinked hooks

Remove the old install before installing the plugin, so each gate runs once:

1. Delete the `plan-gate.mjs`, `plan-approved.mjs` and `code-gate.mjs` entries from `hooks` in `~/.claude/settings.json`.
2. `rm ~/.claude/hooks/codex-review ~/.claude/skills/feature ~/.claude/skills/codex-review` (symlinks only).
3. Rename skill references in your own instructions: `feature` is now `agent-loop:plan-feature` and `agent-loop:implement-plan`, and `codex-review` is `agent-loop:codex-review`.

## Configure

`config.json` sets the Codex model, the optional reasoning `effort`, the round caps (`planRounds`, `codeRounds`) and the run timeout (`timeoutSec`).

## Test

```bash
npm test
```

Codex is replaced by `test/fixtures/fake-codex.mjs` through `CODEX_BIN`; `CODEX_REVIEW_HOME` and `CODEX_REVIEW_CONFIG` redirect state and config.
