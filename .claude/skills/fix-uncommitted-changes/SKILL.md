---
name: fix-uncommitted-changes
description: Use after review-uncommitted-changes has reported findings in this conversation and the user wants them fixed.
allowed-tools: Bash(git status), Bash(git diff:*), Bash(bun run typecheck), Bash(bun test), Bash(bun run dev:cli)
---

# Fix uncommitted changes

Apply the fixes for the numbered findings from the latest `review-uncommitted-changes` report. Do not commit or push.

## Steps

1. **Find the report.** Use the most recent `review-uncommitted-changes` output in this conversation. If there is none, run `review-uncommitted-changes` first instead of guessing what to fix.
2. **Pick what to fix.**
   - Fix every `blocker` and `should-fix`.
   - Fix a `nit` only if the user asked or it is a one-line change.
   - Skip a finding the user rejected, or one that turns out wrong after reading the code, and say why.
   - If a fix has more than one reasonable approach with different trade-offs, ask the user before choosing.
3. **Edit.** Smallest correct change, only in files that are already part of the uncommitted work (or directly required by the fix), matching the surrounding style. Never add `any`, `@ts-ignore` or loosen `tsconfig` to make a check pass. If a test fails, fix the code, not the test.
4. **Verify.** `git diff HEAD --stat`, then `bun run typecheck`, `bun test` and, for UI changes, a brief `bun run dev:cli` smoke run.

## Output

```markdown
## Fixes

1. fixed — <what changed, file>
2. skipped — <why>
3. needs decision — <question for the user>

### Checks
- `bun run typecheck`: pass/fail
- `bun test`: N pass / N fail
- `bun run dev:cli`: starts/fails/not run (why)

### Proposed commit
`<type>: <summary>`
```

Numbers match the review findings. Explain any non-obvious fix in one line so the author can explain it in review. Suggest running `review-uncommitted-changes` again if anything beyond nits changed.
