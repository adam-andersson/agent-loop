# Personal working agreements

These apply in every repository, for Claude Code and Codex alike.

- Never run `git commit`. At a commit point, stop and give a draft commit message (why in the body) for the user to check and edit; the user commits.
- Do every editing task in a fresh git worktree under `<repo>/.claude/worktrees/<short-kebab-description>`, on a branch named `<type>/<short-kebab-description>` with a conventional-commit type (`feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `perf`, `ci`, `build`), never in the main checkout.
- Never hard-wrap prose (docs, commit messages, PR descriptions): one line per paragraph or bullet.
- Keep every diff minimal: change only what the task needs, including the cleanup of code you touched, and report unrelated problems you notice as follow-ups instead of fixing them.
- Read before writing: match the surrounding code's patterns, naming and comment density, and reuse existing helpers before adding new ones.
- Build for the cases that exist now; add abstractions, options and error handling when a real case needs them.
- Comments explain why: intent, constraints and non-obvious contracts.
- Test correctness: add a test only when it would catch a plausible bug in behaviour the code promises and still pass after a refactor that keeps that behaviour. Assert argument order, call sequences or exact wording only when the contract requires them.
- Keep failing tests honest: fix the code, or the test when it is genuinely wrong; never skip, delete or loosen a test to go green.
- Before claiming done, run the repository's applicable tests and checks, then back the claim with evidence: which checks ran, what failed, and what you could not run or verify, and why.
- Make routine implementation choices yourself by following existing conventions, and say which you took; ask when a choice needs the user's intent or authority.
- Ask before destructive git or filesystem operations (force push, `reset --hard`, deleting untracked files) unless the user has already authorized that operation.
