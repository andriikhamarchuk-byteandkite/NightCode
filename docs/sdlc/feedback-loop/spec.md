# Spec: automated feedback loop and approval gates

Author: Andrii Khamarchuk. Status: draft.
Source: [intent.md](./intent.md) (commit `2b0d6a3`).

## Findings that close the intent's open questions

These were checked on the branch before writing the spec.

| Question | Finding | Decision |
| --- | --- | --- |
| Does `prisma generate` work without `DATABASE_URL`? | `DATABASE_URL="" bunx prisma generate` exits 0. `generated/prisma` is gitignored, so CI must generate it. | CI runs `bun install`, and its `postinstall` generates the client. No DB and no secret are needed. |
| Does the `server` typecheck pass? | `tsc --noEmit` exits 0 in `server`, `shared` and `database`, and `cli` passes as before. | Add typecheck scripts to those packages. No code fixes are needed. |
| Bash + `jq` or Bun for the hook? | `jq` isn't a project dependency, and on Windows it was installed by hand. Bun is already required by the repo. | Write the hook in TypeScript and run it with `bun`. It works the same in Git Bash and on Linux. |
| Is a repo-scoped `ANTHROPIC_API_KEY` secret allowed? | It isn't configured yet. It is the author's own learning repo. | AI jobs check for the secret and skip with a notice when it's missing. Core CI never depends on it. |

## Requirements

### Verification (Test stage)

- **R1.** The root `bun run typecheck` checks `cli`, `server`, `shared` and
  `database`. It exits non-zero if any package fails.
- **R2.** The root `bun test` runs the Bun test runner across the workspace. The
  first suite covers `packages/shared/src/schemas.ts`: valid and invalid message
  parts and the `MAX_MESSAGE_LENGTH` limit. An optional second suite covers
  `executeLocalTool` path and secret guards in `packages/cli/src/lib/local-tools.ts`.
- **R3.** Both commands are fast enough to run before every "done" (under about
  a minute on a clean tree), and they need no network, DB or `.env`.

### Instructions and knowledge (Build stage)

- **R4.** `CLAUDE.md` documents the commands, conventions, architecture and
  "things Claude gets wrong" taken from real review fixes. It also has a
  "Verifying your work" section that requires R1 and R2 before reporting done.
- **R5.** The existing skills (`review-uncommitted-changes`, `fix-pr-issues`,
  `create-pr`) and the PR template use R1 and R2 instead of the cli-only
  typecheck.
- **R6.** A new `write-intent` skill encodes the intent.md template.
- **R7.** A `verifier` subagent runs R1 and R2 with scoped tools and reports
  results only.

### CI (Test and Deploy stages)

- **R8.** `.github/workflows/ci.yml` runs on `pull_request` and on `push` to
  `main`:
  - `bun install --frozen-lockfile`;
  - `bun run typecheck`;
  - `bun test`.

  It uses `permissions: contents: read` and no secrets.
- **R9.** `agent-evals.yml` runs a small eval set (`evals/*.json`) on PRs that
  touch `CLAUDE.md` or `.claude/**`, and also on manual dispatch. It skips when
  the secret is absent.
- **R10.** `claude-review.yml` runs an AI review on PRs, guided by `REVIEW.md`
  (bugs, security and compliance passes, at most five nits). It only comments
  and never approves.
- **R11.** If the CI job fails, Claude writes a short triage of the failure log
  into the job summary. This needs the secret and is skipped otherwise.

### Approval gates (Deploy stage)

- **R12.** A `PreToolUse` hook on `Bash` blocks with exit code `2` and a reason:
  - `prisma migrate` and `db:migrate:deploy`;
  - `git push` targeting `main`;
  - any command containing both `deploy` and `production`.

  Each of these is allowed only when `RELEASE_APPROVAL` is set by the human.
- **R13.** A `PreToolUse` hook on `Edit|Write` blocks changes to `*.test.ts`
  when `PROTECT_TESTS=1`. This is the "fix the code, not the test" mode.
- **R14.** The existing `.claude/settings.json` deny-list is kept unchanged. New
  rules only add restrictions or allow the read-only R1 and R2 commands.

### Maintain stage

- **R15.** `scripts/ci-metrics.ts` reads recent runs through `gh run list` and
  reports the CI failure rate against a threshold. When the threshold is
  breached, it writes a draft `docs/sdlc/<date>-ci-failures/intent.md`.

## Design

```text
developer / Claude session
  ├─ CLAUDE.md + skills ──► bun run typecheck && bun test   (local loop)
  ├─ verifier subagent ───► same commands, report only
  └─ PreToolUse hook ─────► blocks migrate / push main / prod deploy
            │
            ▼ git push (feature branch)
GitHub Actions
  ├─ ci.yml ──────────────► install → typecheck → test   (required signal)
  │     └─ on failure ────► Claude triage → job summary  (optional, secret)
  ├─ claude-review.yml ───► REVIEW.md passes → PR comments (optional, secret)
  └─ agent-evals.yml ─────► evals/*.json when .claude/** changes (optional)
            │
            ▼ human review + merge (Olexiy Syvak)
scripts/ci-metrics.ts ────► failure rate > band → new intent.md
```

- **Root scripts.** `typecheck` runs each package's own `typecheck` script in
  turn, so every package keeps control of its `tsconfig`. `test` is
  `bun test`.
- **Hook.** `.claude/hooks/approval-gate.ts` reads the hook JSON from stdin. It
  inspects `tool_name` and `tool_input`, prints a reason to stderr and exits
  `2` to block or `0` to allow. It is registered in `.claude/settings.json`
  under `hooks.PreToolUse` with `bun ${CLAUDE_PROJECT_DIR}/.claude/hooks/approval-gate.ts`.
- **Artifacts.** Everything for this change lives in `docs/sdlc/feedback-loop/`.
  The cross-lesson mapping is in `docs/sdlc/README.md`.

## Human approval boundary

| Gate | Who approves | Mechanism |
| --- | --- | --- |
| intent.md, spec.md, plan.md | Author, then the reviewer in the PR | Commit, then PR review |
| Code merge | Olexiy Syvak | GitHub PR approval. CI and AI review only inform. |
| DB migration, push to `main`, prod deploy | A human, per action | Hook blocks unless `RELEASE_APPROVAL` is set. The existing deny-list stays. |
| Destructive shell (`rm -rf`, `git push --force`) | Not allowed for the agent | Existing `permissions.deny`, unchanged |

## Policy flags and areas of concern

- **Secrets.** Only `ANTHROPIC_API_KEY` may be used, and only by the optional AI
  jobs. Workflows never echo it. Fork PRs don't get secrets, so the AI jobs skip
  on them.
- **Cost.** The AI review and evals run only on PRs (evals only when `.claude/**`
  changes) or on manual dispatch. There are no scheduled runs.
- **Hook bypass.** `RELEASE_APPROVAL` is a speed bump for the agent, not a
  security boundary: a human can always run commands directly. This is
  acceptable for a learning repo, and managed settings are out of scope.
- **Stacked branch.** The PR base is `869f84gvg-client-side-tools`. CI must
  trigger on `pull_request` regardless of base branch.
- **Windows.** The hook runs through `bun`, not `bash`/`jq`, so it behaves the
  same on the author's machine and in CI.

## Out of scope

- Managed or org-level settings, sandboxing and `allowManagedHooksOnly`.
- Branch protection rules and required checks (org/repo admin settings).
- Production deploy pipeline: the project has no production deploy target.
- Scheduled Claude Security scans and Claude Tag on-call.
