# agent-loop

A Claude Code plugin in which Codex reviews Claude's plans and code, as two separate loops with Claude triaging the findings.

## Plan loop

```
Claude calls ExitPlanMode ──► Codex reviews the plan
   ▲                            │ blocking findings, under the round cap → deny: Claude triages and revises
   └────────────────────────────┘ otherwise → the approval dialog, with the review: the user decides
```

## Code loop

```
User approves the plan ──► records the plan and the tree as the section base
Claude stops with changes ──► Codex reviews the whole section (base..now) against the plan
   ▲                            │ blocking findings, under the round cap → block: Claude triages, fixes, stops again
   └────────────────────────────┘ pass → notice, the base moves on; cap reached → notice, the user decides
```

Each round is a fresh review of the current plan or section, with Codex's previous report and Claude's reply as context, so a blocker Codex no longer reports is fixed. At the round cap the code loop keeps the section base, so later rounds still cover the unresolved section until a pass. A stop with nothing changed since a block goes through with a notice; Claude Code's own cap on consecutive Stop blocks is the outer guard.

A follow-up that changes behaviour revises the approved plan through `ExitPlanMode`, so Codex reviews the full revised plan and the code review checks against it. Approving a revised or new plan replaces the plan and keeps the section base, so edits not yet reviewed stay in review; after the round cap, approval accepts the capped review and moves the base to the tree it covered.

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

## Configure

Set the options in `/plugin` → agent-loop → Configure options. Each one is read from the plugin's `userConfig`, and an unset option uses its default from `.claude-plugin/plugin.json`:

- `model`: the Codex model (`gpt-6.1-sol`).
- `effort`: Codex's reasoning effort, unset by default.
- `planRounds`, `codeRounds`: the round caps (3 each).
- `timeoutSec`: the timeout for one Codex run (1200).

## Develop

The hooks are TypeScript that Node (≥ 24.3) runs directly by stripping types, so there is no build step; `tsc` only type-checks. The repository commits no lockfile: with a lockfile at the plugin root, Claude Code installs its dependencies on every plugin install.

```bash
npm install
npm run check
```

Codex is replaced by `test/fixtures/fake-codex.ts` through `CODEX_BIN`. `CLAUDE_PLUGIN_DATA` redirects state, and `CLAUDE_PLUGIN_OPTION_<KEY>` sets an option, as Claude Code does.
