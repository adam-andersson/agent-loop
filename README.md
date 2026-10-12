# agent-loop

Claude Code hooks and skills that put Codex review gates around Opus planning and implementation:

```
Opus plans ──ExitPlanMode──► plan-gate: Codex reviews the plan
   ▲                           │ blocking findings → deny, Opus triages (codex-review skill) and revises
   └───────────────────────────┘ approve / escalate / not reviewed → "ask": the user approves or rejects
User approves ──► plan-approved: records the plan and snapshots the tree, turns on the code gate
Opus implements (feature skill, outside-in TDD) and stops ──► code-gate: Codex reviews the cycle's diff
   ▲                           │ blocking findings → block the stop, Opus triages and fixes
   └───────────────────────────┘ pass → next section; escalate → paused until the user commits or approves a plan; not reviewed → notice, stop allowed, retried on the next stop
```

Claude Code's plan approval dialog shows neither a hook's reason nor its `systemMessage`, so whenever the plan gate hands the plan to the user it appends a `## Codex review` section to the plan through `updatedInput`; that is what the dialog displays. The code gate's outcomes reach the user as one-line `systemMessage` notices.

- Both gates prompt Codex for an adversarial review, adapted from the Codex plugin's `prompts/adversarial-review.md`: tagged blocks for stance, attack surface (one for plans, one for code), finding bar, grounding and calibration, with the plan, diff and dispositions last as untrusted data that is never closed. Every evidenced blocker must be reported in whatever round it is found, because the gate passes once none is open.
- Codex always runs read-only with an explicit model (`hooks/codex-review/config.json`), the prompt on stdin, and a JSON schema for its findings. A failed, empty, truncated or file-less run is "not reviewed", never a pass.
- Snapshots are git tree objects (temporary index + `write-tree`); nothing is committed. Each round reviews the whole cycle (`cycleBase..tree`) and names what changed since the previous round.
- The hooks own `ledger.json` (findings, rounds, snapshots, raw Codex outputs under `reviews/`). Opus writes only `dispositions.json`, which Codex sees as claims to verify; dispositions never close a finding. Only Codex's `resolved` or `withdrawn` does, and a carried finding it doesn't mention stays open.
- Escalation to the user: the round cap, a `needs-human` disposition, or Codex keeping open a finding Opus rejected with evidence.
- State lives in `~/.cache/claude-codex-review/<session>/<repo-hash>/`, one per session and repository, shared by all its worktrees: a plan approved in the main checkout gates code stopped in a worktree. An escalation pause belongs to the checkout that escalated and ends only on a commit there.

## Install

```bash
ln -s ~/dev/agent-loop/hooks/codex-review ~/.claude/hooks/codex-review
ln -s ~/dev/agent-loop/skills/feature ~/.claude/skills/feature
ln -s ~/dev/agent-loop/skills/codex-review ~/.claude/skills/codex-review
ln -s ~/dev/agent-loop/codex/AGENTS.md ~/.codex/AGENTS.md
```

Then add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "ExitPlanMode", "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/codex-review/plan-gate.mjs\"", "timeout": 1500 }] }
    ],
    "PostToolUse": [
      { "matcher": "ExitPlanMode", "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/codex-review/plan-approved.mjs\"" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/codex-review/code-gate.mjs\"", "timeout": 1500 }] }
    ]
  }
}
```

and import the shared agreements in `~/.claude/CLAUDE.md` with `@~/.codex/AGENTS.md`. Keep the Codex plugin's own stop review gate disabled.

## Test

```bash
npm test
```

Codex is replaced by `hooks/codex-review/test/fixtures/fake-codex.mjs` through `CODEX_BIN`; `CODEX_REVIEW_HOME` and `CODEX_REVIEW_CONFIG` redirect state and config.
