# AI-native SDLC in NightCode

How the lessons of [The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)
map onto this repository. The first change taken through the full flow is
[feedback-loop](./feedback-loop/), an automated feedback loop with approval
gates (ticket [869f1am8w](https://app.clickup.com/t/869f1am8w)).

Each lesson is one commit on the branch, in course order, so a reviewer can
read the history lesson by lesson.

## Lesson → artifact

| Stage | Lesson | Artifact in this repo | Commit | What it does here |
| --- | --- | --- | --- | --- |
| Plan | Capture as intent.md | [`feedback-loop/intent.md`](./feedback-loop/intent.md) | `2b0d6a3` | Problem with evidence (three "from review" fixes, no CI), outcome, constraints, acceptance conditions, open questions |
| Design | Requirements and design | [`feedback-loop/spec.md`](./feedback-loop/spec.md) | `f103cbd` | Answers the open questions by checking the repo, lists requirements R1–R15, the human approval boundary and policy flags |
| Build | Plan mode as the default start | [`feedback-loop/plan.md`](./feedback-loop/plan.md) | `fabd4e4` | Written in a read-only plan-mode session from spec.md: files, order, risks, proof |
| Build | The CLAUDE.md | [`/CLAUDE.md`](../../CLAUDE.md) | `53d8c8f` | Commands with healthy output, conventions, architecture, "Things Claude gets wrong" taken from real review fixes |
| Test | Give Claude a feedback loop | root `typecheck` / `test` scripts, [`schemas.test.ts`](../../packages/shared/src/schemas.test.ts), [`local-tools.test.ts`](../../packages/cli/src/lib/local-tools.test.ts) | `aa11522` | One command checks all packages; tests pin the path and secret guards that review had to fix |
| Build | Skills as institutional knowledge | [`.claude/skills/*`](../../.claude/skills/), new [`write-intent`](../../.claude/skills/write-intent/SKILL.md) | `9877145` | Every skill uses the same verification as CI; the intent template is encoded as a skill |
| Build | Parallel sessions and subagents | [`.claude/agents/verifier.md`](../../.claude/agents/verifier.md), `claude --worktree` | `36d8a47` | A Haiku subagent that can only run the two checks (enforced by its own hook) and returns a 4-line verdict |
| Test | Continuous evals in CI | [`ci.yml`](../../.github/workflows/ci.yml), [`agent-evals.yml`](../../.github/workflows/agent-evals.yml), [`evals/`](../../evals/) | `1f0eb89` | CI runs typecheck and tests on every PR; agent evals test the instructions whenever `CLAUDE.md` or `.claude/**` change |
| Deploy | AI in the PR review loop | [`/REVIEW.md`](../../REVIEW.md), [`claude-review.yml`](../../.github/workflows/claude-review.yml) | `117c9f7` | Bugs / Security / Compliance passes, a cap on nits; it only comments, and the same rules apply locally |
| Deploy | Hooks as approval gates | [`.claude/hooks/approval-gate.ts`](../../.claude/hooks/approval-gate.ts), [`settings.json`](../../.claude/settings.json) | `0562289` | Blocks secret-file access always, and migrations, pushes to `main` and prod deploys without `RELEASE_APPROVAL` |
| Deploy | CI/CD integration and deployment | triage step in [`ci.yml`](../../.github/workflows/ci.yml) | `57a5641` | On a red run, Claude reads the log (read-only) and writes cause / kind / next step into the run summary |
| Maintain | Closing the loop on metrics | [`scripts/ci-metrics.ts`](../../scripts/ci-metrics.ts), [`metrics.md`](./metrics.md) | `a63c313` | CI failure rate against a band: log, diagnose or draft a new intent.md |

## Human approval boundary

Automation does the mechanical work between gates. A person decides at each
gate.

| Gate | Who | How it is enforced |
| --- | --- | --- |
| intent → spec → plan | Author, then the reviewer in the PR | Each artifact is committed. The commit and PR review are the record. |
| Code merge | Olexiy Syvak | GitHub approval. CI, AI review and triage only inform. |
| DB migration, push to `main`, prod deploy | A human, per action | The approval-gate hook blocks unless the session was started with `RELEASE_APPROVAL` |
| Destructive shell, force-push, reading `.env` | Nobody (the agent can't) | The existing `permissions.deny` (unchanged) plus the hook |
| Fixing a bug against a failing test | The test stays fixed | `PROTECT_TESTS=1` blocks edits to `*.test.ts` |

## Feedback loops

- **Instructions:** a repeated review finding goes into `CLAUDE.md` ("Things
  Claude gets wrong") or `REVIEW.md`.
- **Evals:** an agent mistake becomes an eval in `evals/`. Changes to
  instructions are gated on 100% eval pass.
- **Tests:** a bug that reached review becomes a test before or with the fix.
- **Maintenance:** a CI band breach drafts a new `intent.md`, which starts the
  flow again at Plan.

## Deliberately not adopted

The playbook targets enterprise teams. These controls don't fit a
single-developer learning repo, or they need access this repo doesn't have:

| Control from the playbook | Why not here |
| --- | --- |
| Managed settings, `allowManagedHooksOnly`, `disableBypassPermissionsMode` | Org-level administration, out of the ticket's scope. The team-scoped `.claude/settings.json` is used instead. |
| Sandbox with a network allowlist | Needs per-machine setup. The README already lists that bash is not sandboxed as a known limitation. |
| Branch protection and required checks | Repository admin settings, not code. CI is in place, so they can be switched on later without code changes. |
| Production deploy pipeline and release manager gate | NightCode has no production target. The hook already reserves `deploy … production` for human approval. |
| Scheduled evals and nightly cron | Cost. Evals run on instruction changes and on demand. |
| Western Electric rules and sigma bands | Too few runs for statistics. A fixed threshold with a minimum sample is used instead. |
| Claude Tag on-call, scheduled Claude Security scans | Need Slack or Teams, an on-call rotation and org-level setup |
| Legacy system sync (Jira and repo as two sources of truth) | ClickUp holds the ticket and the repo holds the artifacts, linked by ticket ID in branch, PR and intent |

## Adding the next change

1. Use the `write-intent` skill to draft `docs/sdlc/<change>/intent.md`, and
   commit it.
2. Ask Claude for `spec.md` from the intent, resolve its open questions, and
   commit it.
3. Start Claude Code in plan mode with the spec, approve `plan.md`, and commit
   it.
4. Build. Before every commit, run `bun run typecheck && bun test` (or the
   `verifier` agent).
5. Open the PR with `create-pr`. CI, AI review and triage inform, and a human
   merges.
