# Plan: automated feedback loop and approval gates (from intent.md 2026-10-05)

Author: Andrii Khamarchuk. Status: approved in plan mode.
Inputs: [intent.md](./intent.md) (`2b0d6a3`), [spec.md](./spec.md) (`f103cbd`).
Branch: `869f1am8w-ai-native-sdlc`, stacked on `869f84gvg-client-side-tools` (PR #12).

## Files that change

### Verification (R1–R3)

- `package.json` (root): add `typecheck` and `test` scripts, plus `typescript`
  as a devDependency.
  - `typecheck` runs each package's script in turn:
    `bun run --cwd packages/cli typecheck && bun run --cwd packages/server typecheck && ...`
  - `test` is `bun test`.
  - `typescript` is currently declared only in `packages/cli`, and the other
    packages get it through hoisting.
- `packages/server/package.json`, `packages/shared/package.json` and
  `packages/database/package.json`: add `"typecheck": "tsc --noEmit"`.
  `shared` has no `scripts` block yet, so add one.
- New `packages/shared/src/schemas.test.ts`, using `bun:test`, against
  `packages/shared/src/schemas.ts`:
  - `modeSchema` accepts the known modes and rejects others;
  - tool input defaults, `readFile` ranges and the bash timeout cap;
  - PLAN mode offers only read-only tools.

  This was revised during build: `messagePartSchema` and the
  `MAX_MESSAGE_LENGTH` boundary from the first draft don't exist on this
  branch (see spec R2).
- New `packages/cli/src/lib/local-tools.test.ts` (optional), against
  `executeLocalTool` in `packages/cli/src/lib/local-tools.ts`.
  - Run it in a temp dir: `process.chdir(mkdtemp)`, restored in `afterAll`.
  - Cases:
    - `readFile` of `../outside` throws;
    - `readFile` of `.env` throws;
    - a write tool in `Mode.PLAN` throws.

### Instructions, skills, agents (R4–R7)

- New `CLAUDE.md` (root). Sections:
  - Commands;
  - Conventions;
  - Architecture;
  - Things Claude gets wrong;
  - Verifying your work.
- Update the skills that hardcode `bun run --cwd packages/cli typecheck` so
  they use `bun run typecheck` and `bun test`:
  - `.claude/skills/review-uncommitted-changes/SKILL.md`, lines 4, 14, 21 and 40;
  - `.claude/skills/fix-uncommitted-changes/SKILL.md`, lines 4, 20 and 32;
  - `.claude/skills/fix-pr-issues/SKILL.md`, lines 12–13, 106, 126 and 193.
    Also drop the stale "currently only `packages/cli`".
  - `.claude/skills/create-pr/SKILL.md`, lines 4, 16 and 25.
- `.github/PULL_REQUEST_TEMPLATE.md:23`: change the check to
  `bun run typecheck && bun test`.
- New `.claude/skills/write-intent/SKILL.md`: the intent.md template and a
  step-by-step workflow.
- New `.claude/agents/verifier.md`. Tools: `Read`, `Grep`,
  `Bash(bun run typecheck)` and `Bash(bun test)`. It reports pass/fail and the
  first error.
- `.claude/settings.json`: add allows for `Bash(bun run typecheck)` and
  `Bash(bun test)`. The `deny` block stays unchanged.

### CI and AI (R8–R11)

- New `.github/workflows/ci.yml`:
  - triggers `pull_request` and `push` to `main`;
  - `permissions: contents: read`;
  - steps: `actions/checkout@v4`, `oven-sh/setup-bun@v2`,
    `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`.
- Add a failure-triage step to `ci.yml`:
  - runs on `if: failure() && env.HAS_KEY == 'true'`;
  - runs `claude -p` over the captured logs;
  - writes the result to `$GITHUB_STEP_SUMMARY`.
- New `evals/` with 2–3 `*.json` files (`prompt` plus a `check` command) and
  `evals/check.sh`.
- New `.github/workflows/agent-evals.yml`:
  - triggers `pull_request` with `paths: ['CLAUDE.md', '.claude/**']`, and
    `workflow_dispatch`;
  - skips without the secret.
- New `REVIEW.md` (root):
  - passes Bugs, Security and Compliance;
  - a definition of Important;
  - at most 5 nits;
  - Do not report: `packages/database/generated/**` and anything CI already
    enforces.
- New `.github/workflows/claude-review.yml`: runs `anthropics/claude-code-action`
  with a prompt that points to `REVIEW.md`. It only comments and skips without
  the secret.

### Approval gates (R12–R14)

- New `.claude/hooks/approval-gate.ts`. It reads the hook JSON from stdin.
  - For `Bash` it blocks with exit `2` when `RELEASE_APPROVAL` is not set:
    - `prisma migrate`;
    - `db:migrate:deploy`;
    - `git push` targeting `main`;
    - `deploy` together with `production`.
  - For `Edit` and `Write` it blocks `*.test.ts` when `PROTECT_TESTS=1`.
- `.claude/settings.json`: register it under `hooks.PreToolUse`:
  - matchers `Bash` and `Edit|Write`;
  - command `bun "${CLAUDE_PROJECT_DIR}/.claude/hooks/approval-gate.ts"`.
- New `.claude/hooks/approval-gate.test.ts`: table-driven exit-code tests that
  spawn the hook with sample JSON.

### Maintain and mapping (R15)

- New `scripts/ci-metrics.ts`:
  - reads `gh run list --workflow ci.yml --json conclusion,createdAt --limit N`;
  - computes the failure rate;
  - with `--threshold` and a breach, writes
    `docs/sdlc/<date>-ci-failures/intent.md`.
- New `docs/sdlc/metrics.md`: metrics and tiers (log, diagnose, propose).
- New `docs/sdlc/README.md`: a table of lesson → artifact → what we deliberately
  skip.

## Order of work

Each step is one commit, ordered by course stage. Run the verification commands
before every commit from step 5 onward.

1. ~~intent.md~~ (done, `2b0d6a3`)
2. ~~spec.md~~ (done, `f103cbd`)
3. `docs: add implementation plan`: this file.
4. `docs: add CLAUDE.md`: points at commands that step 5 creates. Step 5 makes
   them true.
5. `feat: add typecheck and test feedback loop`: root and package scripts,
   `typescript` devDependency, schema tests (plus optional local-tools tests),
   settings allow.
6. `chore: point skills at shared verification commands`: 4 skills, the PR
   template and the new `write-intent` skill.
7. `chore: add verifier subagent`. Then demo two parallel worktree sessions,
   with a screenshot for the PR.
8. `ci: run typecheck and tests on pull requests`: `ci.yml`, plus `evals/` and
   `agent-evals.yml`.
9. `ci: add claude PR review with REVIEW.md`: `REVIEW.md`,
   `claude-review.yml`, and a reference from `review-uncommitted-changes`.
10. `feat: add PreToolUse approval gate hook`: the hook, its test and the
    settings registration.
11. `ci: triage failed builds with claude`: the failure step in `ci.yml`.
12. `feat: add CI control band check`: `ci-metrics.ts` and `metrics.md`.
13. `docs: map playbook lessons to NightCode`: `docs/sdlc/README.md`.
14. Push, open the PR against `869f84gvg-client-side-tools`, then run the
    red/green CI demo.

## Risks

- **`bun test` picks up stray files.** It scans the whole workspace, including
  `node_modules` and `packages/database/generated`. Mitigation: confirm it finds
  only `*.test.ts` under `packages/` and `.claude/hooks/`. If not, add a
  `bunfig.toml` with `[test] root`.
- **Hoisted `typescript`.** `bunx tsc` in `server` works today only through
  hoisting. Mitigation: the root devDependency, plus
  `bun install --frozen-lockfile` in CI catches lockfile drift.
- **local-tools tests touching the real repo.** `executeLocalTool` resolves
  paths against `process.cwd()`. Mitigation: chdir into a temp dir, and never
  test `bash` or write tools against the repo.
- **The hook blocking legitimate work.** Mitigation: match narrowly (only
  `main` as the push target), give a clear stderr reason, and use
  `RELEASE_APPROVAL=1` as an explicit human override. Unit tests cover
  allow-cases too.
- **A hook bug blocking every Bash call.** Mitigation: wrap the parse in
  try/catch. On invalid JSON, allow and log. The fallback is the deny-list,
  which still applies.
- **Secrets on a stacked PR.** The AI workflows fail on PRs without the
  secret. Mitigation: guard on secret presence and skip cleanly. Core CI never
  needs a secret.
- **CI does not trigger on a stacked base.** Mitigation: `pull_request` with no
  `branches` filter.
- **Scope creep past the 4h budget.** Cut order: step 11, then the agent evals
  in step 8, then the script in step 12 (keep the doc).

## Proof

| Requirement | Proof |
| --- | --- |
| R1 | `bun run typecheck` exits 0. A deliberate type error in `server` makes it exit non-zero. |
| R2–R3 | `bun test` passes locally in under 1 minute, with no `.env` and no network. |
| R4–R7 | `CLAUDE.md` commands match `ci.yml`. `grep -rn "packages/cli typecheck" .claude .github` finds nothing. The verifier subagent run is in the PR screenshots. |
| R8 | On the PR, a commit with a type error shows a red `ci` check, and the fix commit shows green. Both run links go in the PR. |
| R9–R11 | Without the secret the jobs show "skipped". With the secret: review comments, eval results and a triage summary. |
| R12–R13 | `approval-gate.test.ts` passes. Live: asking Claude to run `git push origin main` gets blocked with the reason shown. |
| R14 | `git diff 869f84gvg-client-side-tools -- .claude/settings.json` shows the `deny` block unchanged. |
| R15 | `bun scripts/ci-metrics.ts --threshold 0` prints the rate and writes a draft intent.md. |
