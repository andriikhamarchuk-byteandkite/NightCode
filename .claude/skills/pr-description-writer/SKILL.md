---
name: pr-description-writer
description: Writes the pull request description from the current branch diff and commits. Use whenever the user asks to create, open or make a PR, or to write or draft a PR description. Do not use for explaining code, fixing bugs or reviewing someone else's PR.
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status)
---

# PR description writer

Draft the PR description for the current branch. Reading git history is pre-approved; pushing and creating the PR are not, and only happen when the user asked for a PR.

Project facts:

- Bun workspaces monorepo; packages live in `packages/*` (currently `packages/cli`: OpenTUI + React terminal client).
- Base branch is `main`. Never push to `main`.
- Every PR delivers one NightCode video section (or a daily slice of one) tracked by a ClickUp ticket. Branch names follow `<clickup-task-id>-<short-description>`; the only exception is `project-setup` (section 0, no ticket).
- Reviewers: a peer, then Olexiy Syvak for final acceptance. They check run evidence, so the PR must show the app actually running.

## Steps
1. Run `git log main..HEAD --oneline` and `git diff main...HEAD --stat`.
2. Read the diff only as far as needed to understand the change.
3. Find the ClickUp ticket: take the task ID from the branch name, or ask the user. Skip for `project-setup`.
4. Write the description in the format below and print it in the chat.
5. If the user asked to create the PR, push the branch (`git push -u origin HEAD`) and create it with `gh pr create --base main`, using the draft as the body. Pushing and creating are not pre-approved, so they go through the normal permission prompt.
6. After the PR is created, move the ClickUp task to `review` (`clickup_update_task`). Skip if it is already there or for `project-setup`.

## Format
```
## Ticket
[<ticket name>](https://app.clickup.com/t/<task-id>) — video section <start> → <end>

## Changes
- <one bullet per meaningful change>

## Verification
- <checks that were actually run and their result, e.g. `bun run --cwd packages/cli typecheck`; if none were run, say so>
- Run evidence: <screenshot/recording of `bun run dev:cli`, or "TODO: attach screenshot">
```

## Rules
- Describe only what the diff shows. Do not invent checks, results or screenshots.
- Keep it short: a bullet is one line.
- Mention deviations from the video (newer dependency versions, changed APIs) when the diff contains them.
- Do not include secrets, tokens or internal URLs.
