# Personal working agreements

These apply in every repository, for Claude Code and Codex alike.

- Never run `git commit`. At a commit point, stop and give a draft commit message (why in the body) for the user to check and edit; the user commits.
- Do every editing task in a fresh git worktree under `<repo>/.claude/worktrees/<short-kebab-description>`, on a branch named `<type>/<short-kebab-description>` with a conventional-commit type (`feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `perf`, `ci`, `build`), never in the main checkout.
- Never hard-wrap prose (docs, commit messages, PR descriptions): one line per paragraph or bullet.
