---
name: review-pr
description: "Use when asked to review a colleague's or peer's GitHub pull request, given a PR URL or owner/repo#number. Not for the user's own uncommitted changes (review-uncommitted-changes) or fixing the user's own PR (fix-pr-issues). Usage: /review-pr <github-pr-url>"
---

# Review a colleague's PR

**Usage:** `/review-pr <github-pr-url>`

Peer review of another intern's NightCode PR. Draft the review in the chat; post it to GitHub only after the user explicitly says so. Review comments are written in English.

Colleagues build their own NightCode repos following the same video, so their stack, scripts and structure may differ from this repo. Take facts from their `README.md`, `package.json` files and PR template, not from ours. Shared expectations: one video section (or daily slice) per PR, a linked ClickUp ticket, a filled description, and run evidence (screenshot or recording) that the app works.

## Steps

1. **Parse input.** Accept `https://github.com/<owner>/<repo>/pull/<n>`, `github.com/...`, `<owner>/<repo>#<n>` or `<owner>/<repo>/pull/<n>`. Otherwise ask for the URL.
2. **Fetch.** Load GitHub MCP tools with `ToolSearch` (`select:mcp__github__get_pull_request,mcp__github__get_pull_request_files,mcp__github__get_pull_request_comments,mcp__github__get_pull_request_reviews,mcp__github__get_file_contents,mcp__github__create_pull_request_review`). In parallel: PR (title, body, head/base, mergeable state), changed files with patches, existing inline comments and reviews. Fall back to `gh pr view` / `gh pr diff` only if MCP is unavailable; `gh pr view --comments` omits inline review comments, so also fetch them with `gh api --paginate repos/<owner>/<repo>/pulls/<n>/comments`. Read `README.md` and touched `package.json` files from the PR head with `mcp__github__get_file_contents`.
3. **Context.** From the body: ClickUp ticket, video section, what changed, verification, run evidence. If the ticket link is present, fetch it via `mcp__clickup__clickup_get_task` when accessible, to check scope.
4. **Local run (optional).** Ask whether to run it locally. If yes: check out into a separate worktree (`git worktree add <scratchpad>/pr-<n>` after `git fetch <their-remote> pull/<n>/head:pr-<n>`), never over the user's working tree; `bun install`, their `typecheck` script(s), a brief dev-run smoke test. Remove the worktree afterwards. Otherwise report "not run locally".
5. **Review** the diff against:
   - **Scope:** matches the ticket / video section; no unrelated files, generated output or `node_modules`.
   - **PR hygiene:** branch name, every description section filled, run evidence attached, verification boxes honest, deviations from the video explained.
   - **Correctness:** logic, edge cases, error handling, conflicts with base.
   - **React / OpenTUI / TypeScript:** rules of hooks, effect cleanup, `key` props, APIs exist in the installed OpenTUI version, no `any` / `@ts-ignore` / loosened `tsconfig`.
   - **Dependencies and security:** `bun.lock` changes with `package.json`; no `.env`, keys or tokens committed.
   - **Clarity:** naming, duplication, dead or commented-out code, leftover `console.log`.
6. **Verify each finding** against the actual code before keeping it. Drop anything speculative, already raised in existing comments, or pure personal preference.

## Output (chat)

```markdown
## Review: [<n>] <title>
<link>

**Summary:** <2–3 lines: what the PR does and overall state>
**Verdict:** Approve | Request changes | Comment
**Checks:** <local typecheck / smoke run results, or "not run locally">

### Inline comments
1. `path:line` [blocker|should-fix|nit|question] <comment text as it will be posted>

### General comments
- <PR-level points: missing evidence, scope, description>
```

Verdict: any `blocker` means Request changes; only nits and questions mean Approve or Comment. At most one short line on what is done well; no praise padding.

Comment style: specific, polite, one issue per comment, explain why it matters, suggest the fix (a GitHub `suggestion` block for small changes). The colleague is also learning, so link to docs when pointing at an unfamiliar API.

## Posting

Only after the user explicitly approves the draft (they may edit it first). Post one review with `mcp__github__create_pull_request_review`: `event` = `APPROVE` / `REQUEST_CHANGES` / `COMMENT` matching the verdict, `body` = summary plus general comments, `comments` = inline comments with `path` and `line` on lines that exist in the diff. If MCP returns `Not Found` (token has no access to the colleague's repo), write the same payload plus `commit_id` (PR head SHA) and `"side": "RIGHT"` per comment to a JSON file in the scratchpad and post it with `gh api -X POST repos/<owner>/<repo>/pulls/<n>/reviews --input <file>`. Report the review link.

## Guardrails

- Never push to, commit on, merge, or close the colleague's PR or branch.
- Never resolve or delete anyone's review threads.
- Comment only on lines in the diff; put anything else in general comments.
- Do not post partial reviews or one comment at a time.
