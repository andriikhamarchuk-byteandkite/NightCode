---
name: review-uncommitted-changes
description: Use when asked to review local or uncommitted changes, check whether current work is ready to commit, or audit staged, unstaged or untracked files in this repo.
allowed-tools: Bash(git status), Bash(git status --short), Bash(git diff:*), Bash(bun run --cwd packages/cli typecheck), Bash(bun run dev:cli)
---

# Review uncommitted changes

Review what would go into the next commit and say whether it is ready. Read-only: do not edit files. Fixes are done by `fix-uncommitted-changes`.

Project facts (see `README.md`):

- Bun workspaces monorepo; `packages/cli` is OpenTUI 0.5.x + React 19 + strict TypeScript. The video uses OpenTUI 0.1.x, so APIs may differ; the source of truth is the installed types under `node_modules/.bun/@opentui+*/`.
- Checks: `bun run --cwd packages/cli typecheck` and a smoke run of `bun run dev:cli`. No lint or test scripts yet.
- Learning project: the author must be able to explain every line.

## Steps

1. **Collect.** `git status --short` and `git diff HEAD --stat` (covers staged and unstaged). Read untracked files in full. If nothing changed, say so and stop.
2. **Read.** `git diff HEAD -- <path>` per file. Open surrounding code only when a hunk cannot be judged alone.
3. **Check.** Run typecheck for every touched package that has a `typecheck` script. If `packages/*/src` changed, run `bun run dev:cli` briefly to confirm it starts, then stop it.
4. **Review** only the changed lines against:
   - **Correctness:** does what it intends, edge cases (empty input, missing values), error handling, no logic errors.
   - **React / OpenTUI:** rules of hooks, effect cleanup (listeners, timers), stable `key` props, OpenTUI props and hooks exist in the installed version.
   - **TypeScript:** no `any`, `@ts-ignore`, non-null `!` without reason, or loosened `tsconfig`.
   - **Scope and hygiene:** no unrelated changes, leftover `console.log`, commented-out code, or generated files; `bun.lock` changes together with `package.json`.
   - **Security:** no `.env`, keys or tokens (only `.env.example`); user input validated where it reaches commands or files.
   - **Clarity:** readable names, small focused functions, no duplication, matches surrounding style; non-obvious code has a reason the author can explain.

## Output

```markdown
## Review: uncommitted changes

### Findings
1. `path:line` — [blocker|should-fix|nit] <problem>. <suggested fix>.
2. ...

### Checks
- `bun run --cwd packages/cli typecheck`: pass/fail
- `bun run dev:cli`: starts/fails/not run (why)

### Commit readiness: X/10
<one line: why>

### Proposed commit
`<type>: <summary>` (Conventional Commits, lowercase, matching `git log`)
```

Number findings so `fix-uncommitted-changes` can refer to them. No findings: write "No issues found." Do not pad with praise. A failing check is always a blocker.
