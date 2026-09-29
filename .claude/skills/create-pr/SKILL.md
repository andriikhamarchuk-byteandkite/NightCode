---
name: create-pr
description: Use when the user asks to create, open or make a pull request, submit the current branch for review, or write or draft a PR description for the current branch. Not for reviewing someone else's PR or fixing an existing PR.
allowed-tools: Bash(git branch --show-current), Bash(git status), Bash(git diff:*), Bash(git log:*), Bash(bun run --cwd packages/cli typecheck), Bash(bun run dev:cli)
---

# Create PR

Draft the PR for the current branch from its ClickUp ticket and diff, then (only if asked) push, open it and move the ticket to review. Reading git history and running checks is pre-approved; pushing and creating the PR are not, so they go through the normal permission prompt.

Project facts (see `README.md`):

- Bun workspaces monorepo; packages live in `packages/*` (currently `packages/cli`: OpenTUI 0.5.x + React 19, newer than the 0.1.x in the video).
- Base branch is `main`. Never push to `main`, never force-push.
- Every PR delivers one NightCode video section (or a daily slice of one) tracked by a ClickUp ticket. Branch names follow `<clickup-task-id>-<short-description>`; the only exception is `project-setup` (section 0, no ticket).
- Checks: `bun run --cwd packages/cli typecheck` and a smoke run of `bun run dev:cli`. No lint or test scripts exist yet; do not invent them.
- Reviewers: a peer, then Olexiy Syvak for final acceptance. They check run evidence, so the PR must show the app actually running.
- PR body format lives in `.github/PULL_REQUEST_TEMPLATE.md`.

## Steps

1. **Branch.** `git branch --show-current`. On `main`: stop and ask the user to create a branch. On `project-setup`: no task ID. Otherwise the task ID is the part before the first `-`. `git status`: if there are uncommitted changes, warn that they will not be in the PR and ask whether to continue; the draft covers committed changes only.
2. **Ticket.** Skip for `project-setup`. Load ClickUp tools with `ToolSearch` (`select:mcp__clickup__clickup_get_task,mcp__clickup__clickup_update_task,mcp__clickup__clickup_create_task_comment`) and call `mcp__clickup__clickup_get_task`. Take name, URL, status, and video section / timestamps from the description. If the ID is missing or not found, ask the user.
3. **Changes.** `git log main..HEAD --oneline` and `git diff main...HEAD --stat`. Read the diff only as far as needed to understand the change.
4. **Checks.** Run `bun run --cwd packages/cli typecheck` (plus `typecheck` of any other touched package). Run `bun run dev:cli` briefly to confirm it starts, then stop it. Record the actual results.
5. **Draft.**
   - Title: `[<task-id>] <task name>`. For `project-setup`, use a Conventional Commits title (`chore: ...`).
   - Body: read `.github/PULL_REQUEST_TEMPLATE.md` and fill it. Keep every heading and replace each HTML comment with visible text (comments do not render on GitHub). For `project-setup`, Ticket is `No ticket (section 0: Project Setup)`. Remove "Deviations from video" if the diff (code or dependency versions) has none. Tick a verification box only for a check you ran and that passed. Run evidence: a screenshot or recording the user gave you; terminal output does not count as evidence. If there is none, ask the user for it and do not open the PR (step 6) until they provide it.
   - Print title and body in the chat. If the user asked only for a description, stop here.
6. **Open the PR.**
   - `gh pr list --head <branch>`. If a PR exists, do not create another; offer to update its body with `gh pr edit <number> --body-file <file>`.
   - Write the body to a file in the scratchpad directory (avoids shell quoting issues), then `git push -u origin HEAD` and `gh pr create --base main --title "<title>" --body-file <file>`.
7. **Update ticket.** If the task status is `IN PROGRESS`, set it to `IN REVIEW` with `mcp__clickup__clickup_update_task`. Add a comment with the PR link via `mcp__clickup__clickup_create_task_comment`.
8. **Report.** PR link and ticket status change.

## Rules

- Describe only what the diff shows. Do not invent checks, results or screenshots.
- Changes are conceptual (what the app can now do, what was restructured), one line per bullet; no line numbers, no "added a for loop".
- Mention deviations from the video (newer dependency versions, changed APIs) when the diff contains them.
- No secrets, tokens or internal URLs. No "Generated with ..." or "Made with ..." footers.
