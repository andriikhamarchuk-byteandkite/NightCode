---
name: write-intent
description: Use when the user wants to capture a new change, feature, fix or improvement as an intent.md before any design or code, or when a CI metric breach or incident needs to become a planned change. Not for writing specs or plans of an already-approved intent.
allowed-tools: Read, Grep, Glob, Bash(git log:*), Bash(git status)
---

# Write intent

Turn a conversation, a ticket or an incident into `docs/sdlc/<change>/intent.md`: what is wanted, why, and within which constraints. This is Stage 1 of the SDLC flow in `CLAUDE.md`. No design or code goes in here. An accepted intent is the input for `spec.md`.

## Steps

1. **Collect sources.** Use the user's description, the ClickUp ticket (if given, via `mcp__clickup__clickup_get_task`) and repo evidence. Facts in the intent must come from these sources or from the repo, not from guesses.
2. **Name the change.** Pick a short kebab-case `<change>` slug. If `docs/sdlc/<change>/` already exists, ask before overwriting.
3. **Find evidence.** Read only what is needed to state the problem: the affected files, the related `git log` entries (review-fix commits are strong evidence) and the gaps (missing tests, checks or limits). Quote commit hashes and file paths.
4. **Draft** using the template below. Keep it under a page:
   - Problem: what users or the team cannot do today, with evidence.
   - Proposed outcome: observable results, not implementation.
   - Constraints: include this repo's standing ones (no `.env` reads, the deny-list in `.claude/settings.json` stays, no production secrets in CI, a human approves merges, DB migrations, pushes to `main` and deploys), plus anything specific to the change.
   - Acceptance conditions: checkable statements (commands with expected exit codes, visible behavior).
   - Open questions: real unknowns the spec must answer, each one answerable.
5. **Show the draft** in chat and write the file only after the user confirms. Status stays `draft` until the user commits it: the commit is the approval record.

## Template

```markdown
# Intent: <change in plain words>

Author: <name>. Status: draft.
Ticket: [<id>](<url>)

## Problem

<What cannot be done today and why it matters. Evidence: commits, files, incidents.>

## Proposed outcome

- <Observable result>

## Affected users and systems

- Users: <who>
- Systems: <packages, workflows, settings>

## Constraints

- <Limit the solution must respect>

## Acceptance conditions

- [ ] <Checkable condition>

## Open questions

- <Unknown that the spec must resolve>
```

## Rules

- One change per intent. If the request mixes unrelated changes, propose separate intents.
- No solution design (file layouts, libraries, code). That belongs in `spec.md`.
- Never weaken the standing constraints to fit the request. If the request needs that, write it as an open question for a human decision.
