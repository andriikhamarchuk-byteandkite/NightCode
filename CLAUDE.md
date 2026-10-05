# NightCode

An AI coding agent that runs in the terminal. It is a Bun workspaces monorepo:
the terminal client talks to a Hono API server, and the server streams model
output and runs billing.

## Commands

- Install: `bun install`. Its `postinstall` runs `prisma generate` and needs
  no DB.
- Typecheck (all packages): `bun run typecheck`. A healthy run prints one
  `$ tsc --noEmit` per package and nothing else.
- Test: `bun test`. A healthy run ends with `N pass` and `0 fail`.
- Run the CLI: `bun run dev:cli`. Run the server: `bun run dev:server`.
- DB migrations: `bun run --cwd packages/database db:migrate:deploy`. A human
  runs this, never the agent (see "Approval gates").

## Architecture

- `packages/cli`: the terminal UI (OpenTUI 0.5, React 19) and the
  `bin/nightcode` entry. `src/lib/local-tools.ts` runs the agent's tools on the
  user's machine. `tool-approval.tsx` asks the user before risky tools run.
- `packages/server`: the Hono API. It has auth (Clerk OAuth), chat streaming
  (AI SDK, Anthropic/OpenAI), billing (Polar credits) and Sentry.
  `routes/chat.ts` holds the per-session stream lock.
- `packages/shared`: zod schemas and types shared by the client and server. It
  is the contract for messages and stream events.
- `packages/database`: the Prisma 7 schema and client. The client is generated
  into `generated/prisma`, which is gitignored.
- The client calls the server through the Hono RPC client, so route types flow
  into the CLI. Change a route and the CLI typecheck catches the callers.

## Conventions

- Bun only: no npm, yarn or node-specific scripts. TypeScript is strict, and
  `any` is not allowed.
- Validate anything that crosses a boundary (HTTP body, stream event, tool
  input) with a zod schema from `packages/shared`.
- Read env vars where they are used, not at import time. ESM imports run before
  `.env` is loaded (see `getPolar()` in `server/src/lib/polar.ts`).
- Comments explain *why*, as in the existing code. Don't narrate *what*.
- One ticket per branch, named `<clickup-id>-<slug>`. Branches are stacked: a
  new branch starts from the previous open PR's branch. Bring in updates with
  `git merge`, not rebase.

## Things Claude gets wrong

Each item comes from a real review fix in this repo.

- **Auth errors.** A Clerk or network failure must return 503, not 401: the CLI
  deletes its token on a 401. Call `next()` outside the auth `try`, so route
  errors reach `app.onError` (`0dee479`).
- **Secret files.** Agent tools must never read, grep or edit `.env*`, `*.pem`
  or `id_rsa*`. `.env.example` is the exception. Reuse the existing secret
  checks instead of adding new ones (`0dee479`, `fe6e31d`).
- **Paths.** Resolve tool paths inside the project root and reject anything
  that resolves outside it (`resolveInsideCwd` in `cli/src/lib/local-tools.ts`).
- **Env loading in the CLI.** `bin/nightcode` reads the repo `.env` by path,
  but copies in only `API_URL`, `CLERK_FRONTEND_API` and
  `CLERK_OAUTH_CLIENT_ID`. Never load the whole file: it holds server secrets
  (`fe6e31d`).
- **Session lock.** Take it before the first `await`, release it on every
  early return, and keep the stale-lock TTL (`fe6e31d`).
- **Billing.** Missing token usage counts as 0 and gets logged, without
  throwing. Build redirect URLs from `API_URL`, never from the `Host` header
  (`29e6215`).
- **Scope.** Do not bump dependency versions or reformat untouched files.

## Verifying your work

Run both commands before you report a change as done, and paste their output:

- `bun run typecheck`: it must exit 0.
- `bun test`: all tests must pass. Never skip or delete a failing test.

If a test fails, fix the code, not the test. For UI changes, also do a short
`bun run dev:cli` smoke run and say what you saw.

## Approval gates

- The agent never runs DB migrations, pushes to `main`, force-pushes, runs
  `rm -rf` or reads `.env`. `.claude/settings.json` (deny-list) and the
  `PreToolUse` hook enforce this.
- CI and AI review only inform. A human approves and merges every PR.
- SDLC artifacts for each change live in `docs/sdlc/<change>/`, in the order
  `intent.md` → `spec.md` → `plan.md`.
