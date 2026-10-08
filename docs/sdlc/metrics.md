# Metrics and control bands

Stage 6 of the playbook (Maintain): watch a few numbers with stable
baselines. When one leaves its band, turn it into a new `intent.md` so the fix
goes through the same Plan → Design → Build → Test → Deploy flow.

These metrics fit a single-developer learning repo. Each one can be measured
with `gh` or `git` in under a minute.

## Metrics

| Stage | Metric | Kind | How to measure |
| --- | --- | --- | --- |
| Test | CI failure rate (last 30 runs) | Lagging, banded | `bun run metrics:ci` |
| Test | First-pass CI success: share of PRs whose first CI run is green | Leading | `gh run list --json workflowName,headBranch,conclusion,createdAt`, then take the first run per branch |
| Build | Rework after review: "fix: ... from review" commits per PR | Lagging | `git log --oneline <base>..HEAD \| grep -c "from review"` |
| Deploy | Time to first review: PR opened → first review comment (human or AI) | Leading | `gh pr view <n> --json createdAt,reviews,comments` |
| Deploy | Review rounds before approval | Lagging | Count `CHANGES_REQUESTED` and `COMMENTED` reviews in `gh pr view <n> --json reviews` |
| Plan | Intent → plan lead time: commits between `intent.md` and `plan.md` | Leading | `git log --format=%cs -- docs/sdlc/<change>/` |

Baseline before this change: three PRs in a row needed a "harden ... from
review" commit (`0dee479`, `29e6215`, `fe6e31d`), and CI did not exist.

## Control band: CI failure rate

`scripts/ci-metrics.ts` is the deterministic check. It reads the last N
completed runs of `ci.yml` (cancelled and skipped runs are ignored) and needs at
least 5 runs before it judges anything.

| Tier | Condition (band = 20% by default) | Action |
| --- | --- | --- |
| `ok` | rate < band | Log only |
| `diagnose` | band ≤ rate < 2× band | List the failing runs. A human reads their triage summaries (read-only). |
| `propose` | rate ≥ 2× band | Draft `docs/sdlc/<date>-ci-failures/intent.md` with the evidence |

```bash
bun run metrics:ci                      # default band 20%, last 30 runs
bun run metrics:ci -- --threshold 0.1   # tighter band
bun run metrics:ci -- --dry-run         # report only, never write
```

The drafted intent follows the `write-intent` template and stays `Status:
draft` until a human reviews and commits it. The script never opens PRs or
changes code: the loop goes back to a person at the Plan stage.

## Feedback into the loop

- **Incident → eval.** A failure that reached review or CI and could recur
  becomes a test (in `packages/*` or `tests/`) or an agent eval (`evals/*.json`).
  Example: `refuses-env.json` came from the `cat .env` gap, which the approval
  gate then closed.
- **Repeated review finding → instructions.** If the same review comment
  appears twice, add it to "Things Claude gets wrong" in `CLAUDE.md` or to
  `REVIEW.md`.
- **Band breach → intent.** `propose` tier, as above.

## Not adopted

The playbook also describes scheduled monitors with Western Electric rules,
on-call Claude in Slack (Claude Tag) and scheduled security scans. They need a
production service, an on-call rotation or org-level setup that this learning
repo does not have.
