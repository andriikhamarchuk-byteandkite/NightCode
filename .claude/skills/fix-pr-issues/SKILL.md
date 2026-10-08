---
name: fix-pr-issues
description: "Triage and fix issues on a GitHub Pull Request in this repo until it is merge-ready. Fetches PR context, resolves merge conflicts, addresses review comments, and fixes type-check failures. Stops before committing and presents a proposed commit for human approval. Usage: /fix-pr-issues <github-pr-url>"
---

**Usage:** `/fix-pr-issues <github-pr-url>`

Example: `/fix-pr-issues https://github.com/andriikhamarchuk-byteandkite/NightCode/pull/1`

Project facts (see `README.md`):

- Bun workspaces monorepo: `packages/cli` (OpenTUI + React 19 terminal client), `packages/server` (Hono), `packages/shared` (zod contracts) and `packages/database` (Prisma). See `CLAUDE.md`.
- Verification: `bun run typecheck` (`tsc --noEmit` in every package), `bun test`, and a smoke run of `bun run dev:cli` (the app must start without errors). No lint script exists yet; do not invent one.
- CI in `.github/workflows` runs the same `bun run typecheck` and `bun test`, when present. A red check is a merge blocker.
- Lockfile is `bun.lock` at the repo root.
- Branches are stacked: the PR base is usually the previous PR's branch, not `main`. Sync with the PR's actual base. Never push to `main`.
- This is a learning project: the author must be able to explain every change. Keep fixes minimal, and explain non-obvious ones.

---

## Step 1: Parse input

- Extract the PR URL from the command text. If missing or invalid, stop and ask for a full GitHub PR URL.
- Accept formats:
  - `https://github.com/<owner>/<repo>/pull/<number>`
  - `github.com/<owner>/<repo>/pull/<number>`
  - `<owner>/<repo>#<number>` or `<owner>/<repo>/pull/<number>`

---

## Step 2: Fetch PR context

Prefer the GitHub MCP tools (`mcp__github__*`) over raw `gh` calls. They are deferred, so load them first with `ToolSearch` (`select:mcp__github__get_pull_request,mcp__github__get_pull_request_status,mcp__github__get_pull_request_reviews,mcp__github__get_pull_request_comments,mcp__github__get_pull_request_files`). Parse `<owner>/<repo>/<number>` from the URL first.

Fetch in parallel where possible:

- `mcp__github__get_pull_request`: title, state, mergeable, mergeable_state, head/base ref, body.
- `mcp__github__get_pull_request_status`: combined commit status / checks, if any exist.
- `mcp__github__get_pull_request_reviews`: review states and approvals.
- `mcp__github__get_pull_request_comments`: inline review comments.
- `mcp__github__get_pull_request_files`: changed files.

This MCP server does not expose thread `isResolved` / `isOutdated`. When that matters, fall back to `gh api graphql` (`reviewThreads { isResolved isOutdated comments { body path line } }`). Use `gh pr view "<url>" --json ...` only if the MCP server is disconnected.

Rules when reading the results:

- Read only comment bodies and the minimum location/URL needed to act.
- Do not dump or re-read entire payloads.
- Skip resolved, outdated, or purely informational threads unless they contain an open action item.
- Validate bot findings before fixing; explain when you disagree or are unsure.

Build a prioritized issue list:

1. Merge conflicts / `mergeable_state` not `clean`
2. Failing CI checks, local type-check or test failures, or the app failing to start
3. Unresolved human review comments requesting changes
4. Valid unresolved bot findings

If no actionable issues remain, report PR is merge-ready and stop.

---

## Step 3: Sync local workspace to PR branch

If the PR contains commits by anyone other than the user, ask for explicit approval before running `bun install`, type-check or the smoke run. Approval to commit or push in Step 6 does not count.

```bash
git status            # must be clean before switching; ask the user if not
gh pr checkout "<url>"
git fetch origin
bun install
```

- If the branch is behind its base, merge `origin/<base>` into the PR branch (default). Do not rebase already-pushed branches unless the user asks.
- If merge conflicts exist, resolve intelligently and preserve intent of both sides. If intents conflict, stop and ask for clarification.

Confirm you are on the PR head branch (not `main`) before editing.

---

## Step 4: Fix issues (loop)

Work one category at a time. After each batch, re-run verification before moving on.

### A. Merge conflicts

- Resolve conflict markers in affected files.
- Watch `bun.lock`: resolve every `package.json` first, then regenerate the lockfile with `bun install` from the repo root instead of hand-merging.
- Re-run verification (Step 5).

### B. Review comments

For each unresolved thread:

1. Open the referenced file and line.
2. Read surrounding code and PR diff context: `git diff origin/<base>...HEAD -- <path>` locally (post-checkout), or `mcp__github__get_pull_request_files` if not yet checked out.
3. Apply the smallest correct fix that addresses the comment.
4. Skip nits, style-only prefs, or suggestions already handled unless reviewer explicitly blocked merge.

Do **not** mark GitHub threads resolved via API unless the user explicitly asks.

### C. Type-check / test / startup failures

1. Run from the repo root:
   - `bun run typecheck`
   - `bun test`. If a test fails, fix the code, not the test, unless the reviewer asked for the behavior change the test pins.
   - `bun run dev:cli` briefly to confirm the app starts without errors, then stop it
2. Fix root cause within PR scope only.
3. Never loosen `tsconfig.base.json`, or add `@ts-ignore` / `any` just to pass.
4. Never make unrelated code changes to get a green check.
5. If failure seems unrelated to the PR, first merge the latest `origin/<base>`; another PR may have fixed it.
6. OpenTUI installed here (0.5.x) is newer than in the video (0.1.x). When an API mismatch causes the failure, check the installed types under `node_modules/.bun/@opentui+*/` rather than guessing.
7. For remote checks (`gh pr checks "<url>"`), read failures with `gh run view <run-id> --log-failed`.

Repeat until mergeable + type-check and tests pass + app starts + review items triaged.

---

## Step 5: Verify

Before finishing:

```bash
git status
git diff --stat
bun run typecheck
bun test
bun run dev:cli        # smoke run: starts without errors, then stop it
```

Summarize:

- Issues found
- Fixes applied (file + brief reason)
- Checks still failing (if any)
- Items needing human decision (if any)

---

## Step 6: Stop for human review (do not commit or push)

**Stop here.** Do **not** run `git commit`, `git push`, or any other command that publishes changes unless the user explicitly asks after reviewing.

When fixes were made, prepare a commit preview for the human:

```bash
git status
git diff --stat
git diff          # full unstaged diff, or staged if you ran git add
git log -5 --oneline
```

Then present:

1. **Files changed**: list every path that would be committed.
2. **Summary of changes**: brief per-file rationale tied to the issues fixed.
3. **Proposed commit message**: follow repo style from `git log` (Conventional Commits, lowercase: `fix: ...`, `refactor: ...`, `chore: ...`). Do **not** run `git commit`.
4. **Suggested next commands**: show what the human can run after approval, e.g.:

```bash
git add <paths>
git commit -m "<proposed message>"
git push origin HEAD
```

Rules:

- Type-check and tests must pass and the app must start before any commit (project rule).
- Commit `bun.lock` together with any `package.json` change.
- Stage files with `git add` only if it helps the human see `git diff --cached`; otherwise leave changes unstaged and list paths to add.
- Never commit `.env` files or real keys (only `.env.example`); call out any file that should stay out of the commit.
- Do **not** force-push. It is denied in `.claude/settings.json` and needs explicit user approval anyway.
- Tell the human to review the diff, then commit/push themselves or ask you to commit.

---

## Output format

```markdown
## PR: [<number>] <title>

<link>

### Issues addressed

- [category] <short description> — <files changed>

### Still open

- <item needing user input, if any>

### Checks

- `bun run typecheck`: pass/fail
- `bun test`: N pass / N fail
- CI (`gh pr checks`): pass/fail/none
- `bun run dev:cli` smoke run: starts/fails

### Proposed commit

- **Message:** `<suggested conventional commit message>`
- **Files:** `<paths to stage>`
- **Commands:** `<git add / commit / push the human can run>`

### Next step

- **Awaiting human review**: review diff and proposed commit; commit/push when ready, or ask agent to commit.
- Otherwise: <merge-ready | needs user decision>
```

---

## Guardrails

- Scope fixes to this PR only; do not touch unrelated files.
- Prefer minimal diffs; match existing code style.
- Do not create a new PR.
- Do not close or merge the PR unless explicitly asked.
- Do not amend commits already pushed to remote.
- Do not commit or push unless the user explicitly asks after reviewing the proposed changes.
- Never push to `main`.
- Ask before destructive actions (deleting files, force push, resetting history).
