# Intent: automated feedback loop and approval gates

Author: Andrii Khamarchuk. Status: draft.
Ticket: [869f1am8w](https://app.clickup.com/t/869f1am8w)

## Problem

NightCode has no automated verification. There is no CI, no test suite and no
lint. The only check is a manual `bun run --cwd packages/cli typecheck` plus a
`bun run dev:cli` smoke run, and it covers the CLI package only: `server` has no
typecheck script, and `shared` and `database` are never checked.

Defects therefore surface late, in human review. Each of the last three PRs
needed a follow-up "harden ... from review" commit (`0dee479`, `29e6215`,
`fe6e31d`) covering agent tools, auth errors, billing checks, env loading and
the session lock. The repo also has no guardrail that stops an agent before a
risky action like a DB migration or a push to `main`. The deny-list in
`.claude/settings.json` blocks only `.env` reads, `git push --force` and
`rm -rf`.

## Proposed outcome

- One command verifies the whole repo: typecheck for every package plus
  `bun test`. Claude and humans run the same command before calling work done.
- Every PR runs that command in CI automatically, and a red check is visible
  before review starts.
- Claude gets the same feedback loop locally through `CLAUDE.md`, skills and a
  verifier subagent, so it can fix its own mistakes before a human sees them.
- An AI review pass runs on PRs, using `REVIEW.md` as its rules. It informs the
  human reviewer and never replaces them.
- Hooks block risky agent actions (migrations, pushes to `main`, deploys) unless
  a human explicitly approves them.
- A simple CI health metric closes the loop: when the threshold is breached, it
  produces the next `intent.md`.

## Affected users and systems

- Users:
  - the developer (author of PRs);
  - the reviewer (Olexiy Syvak);
  - Claude Code sessions working in this repo.
- Systems:
  - all `packages/*` (`cli`, `server`, `shared`, `database`);
  - root `package.json` scripts;
  - `.claude/` (settings, skills, agents, hooks);
  - `.github/` (PR template, new workflows);
  - GitHub Actions on `andriikhamarchuk-byteandkite/NightCode`.

## Constraints

- Changes stay inside this learning repository and its CI. No company-wide or
  org-level settings.
- No production secrets in CI. Never read `.env`. AI steps may use only a
  repo-scoped `ANTHROPIC_API_KEY` secret, and if it is missing those steps are
  skipped rather than failing.
- CI is read-only: no deploys, no DB migrations, no DB connection.
- The existing deny-list in `.claude/settings.json` stays as it is. New gates
  only add restrictions.
- Do not weaken TypeScript strictness or skip tests to make checks pass.
- Stay small: it must fit the ticket's 4-hour budget, so no enterprise controls
  (managed settings, sandboxing, org branch protection).
- The branch is stacked on PR #12 (`869f84gvg-client-side-tools`).

## Acceptance conditions

- [ ] `bun run typecheck` checks `cli`, `server` and `shared`, and exits 0 on a
      clean tree.
- [ ] `bun test` runs at least one real test (shared schemas) and passes.
- [ ] A PR with a deliberate type error gets a red CI check. After the fix it
      gets a green one.
- [ ] Piping `git push origin main` or `prisma migrate deploy` into the
      approval-gate hook gives exit code `2` (blocked). A safe command gives
      `0`.
- [ ] `CLAUDE.md` and the skills point at the same verification commands as
      CI.
- [ ] A reviewer can trace intent.md → spec.md → plan.md → PR → CI run.

## Open questions

- Does `bun install` (whose `postinstall` runs `prisma generate`) work in CI
  without `DATABASE_URL`? `prisma.config.ts` reads it from `.env`. If it doesn't
  work, use a dummy value in CI, never a real one.
- Does the `server` typecheck pass today, or will adding it surface existing
  errors that need minimal fixes first?
- Should the hook be a bash script with `jq`, or a Bun script? It has to work in
  Git Bash on Windows and on Linux CI.
- Is a repo-scoped `ANTHROPIC_API_KEY` secret allowed for agent evals and AI
  review? If it isn't, those jobs stay skipped.
