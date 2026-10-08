# Review instructions

Rules for every AI review of a NightCode change: the `claude-review` workflow
on PRs and the `review-uncommitted-changes` skill locally. The project facts and
the recurring mistakes are in `CLAUDE.md`. Read it first.

## Passes

Run three passes over the changed lines and tag each finding with its pass:

- **Bugs:** logic errors, broken edge cases (empty input, missing values,
  aborted streams), unhandled promise rejections, effect cleanup in React,
  regressions in behavior that existing code relied on.
- **Security:**
  - an agent tool reaching outside the project root or into secret files
    (`.env*`, `*.pem`, `id_rsa*`);
  - secrets reaching logs, Sentry, the model or a child process env;
  - auth gaps on server routes;
  - user or model input that reaches a shell, path or SQL without validation;
  - redirect URLs built from request headers.
- **Compliance:**
  - the change matches its `docs/sdlc/<change>/spec.md` and `plan.md` when
    they exist;
  - it follows the conventions in `CLAUDE.md`;
  - new logic in `shared`, `server/src/lib` or `cli/src/lib` comes with a test;
  - no test was weakened or deleted to make CI pass.

## What Important means

Tag a finding **Important** only if it breaks behavior, leaks data or bypasses
a guard (path checks, secret filtering, auth, credit checks, approval gates).
Everything else is a **Nit**.

## Cap the nits

Report at most five nits per review. Summarize the rest as a count ("+3 more
nits"). If there are no Important findings, say so in one line.

## Do not report

- Generated code under `packages/database/generated/`, and `bun.lock` contents.
- Anything CI already enforces: type errors and failing tests.
- Formatting and import order.
- Dependency versions that match the video's newer releases, unless they
  introduce a break.

## Output

Post an inline comment on the line for each Important finding. Post one
top-level summary comment:

```
**AI review** (informational; a human approves merges)
Important: <n> · Nits: <n shown> (+<n> more)
- [Important][Security] path:line — problem. Suggested fix.
- [Nit][Bugs] path:line — problem.
```

Never approve or request changes. The human reviewer decides.
