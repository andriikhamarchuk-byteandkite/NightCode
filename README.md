# NightCode

Personal build of **NightCode** — an AI coding agent app — following the free NightCode build video:
https://www.youtube.com/watch?v=k_D_C3ExypU

Built as part of the Byte&Kite internship (Track A). Each video section is delivered as a separate ClickUp ticket with a reviewed pull request.

## Roadmap

Sections from the video, with source timestamps and time budgets (38h total):

| #  | Section                           | Timestamp | Budget | Status  |
|----|-----------------------------------|-----------|--------|---------|
| 0  | Project Setup & Components        | 0:07:38   | —      | done    |
| 1  | UI Infrastructure                 | 1:16:14   | 4h     | done    |
| 2  | Routing & Screen Layout           | 2:51:25   | 3h     | done    |
| 3  | Server, Shared Package & Database | 3:25:56   | 5h     | done    |
| 4  | Sentry Monitoring                 | 5:08:06   | 1h     | done    |
| 5  | AI Chat Streaming                 | 5:26:13   | 6h     | done    |
| 6  | Session Management                | 7:04:20   | 4h     | done    |
| 7  | Tool Calling                      | 7:39:58   | 5h     | done    |
| 8  | Completing The User Experience    | 8:53:05   | 3h     | done    |
| 9  | Usage Based Billing               | 10:02:57  | 2h     | done    |
| 10 | Client-Side Tool Execution        | 10:36:27  | 5h     | review  |

## Tech stack

- [Bun](https://bun.sh) — runtime, package manager, workspaces
- [OpenTUI](https://github.com/sst/opentui) + React 19 — terminal UI
- [Hono](https://hono.dev) — API server and typed RPC client for the CLI
- [Prisma](https://www.prisma.io) + PostgreSQL — sessions and messages
- [AI SDK](https://ai-sdk.dev) with Anthropic and OpenAI providers — chat streaming and tool calling
- [Clerk](https://clerk.com) — OAuth sign-in
- [Sentry](https://sentry.io) — server error monitoring
- TypeScript (strict)

## Getting started

### Prerequisites

- Bun >= 1.3 (tested with 1.4.2)
- A terminal with true-color support (Windows Terminal, iTerm2, etc.)
- A PostgreSQL database
- An Anthropic and/or OpenAI API key
- A Clerk application with an OAuth application (see [Auth setup](#auth-setup))
- Optional: a Sentry DSN

### Environment

Copy `.env.example` to `.env` in the repo root and fill it in:

| Variable                | Used by | Description |
|-------------------------|---------|-------------|
| `API_URL`               | CLI, server | Server URL, default `http://localhost:3000`; the server also uses it for Polar return links |
| `DATABASE_URL`          | server  | PostgreSQL connection string |
| `SENTRY_DSN`            | server  | Sentry project DSN (optional) |
| `ANTHROPIC_API_KEY`     | server  | Anthropic models |
| `OPENAI_API_KEY`        | server  | OpenAI models |
| `CLERK_FRONTEND_API`    | CLI     | Clerk Frontend API URL, e.g. `https://<your-app>.clerk.accounts.dev` |
| `CLERK_OAUTH_CLIENT_ID` | CLI     | Client ID of the Clerk OAuth application |
| `CLERK_SECRET_KEY`      | server  | Clerk secret key (server refuses to start without it) |
| `CLERK_PUBLISHABLE_KEY` | server  | Clerk publishable key (server refuses to start without it) |

Never commit `.env`; only `.env.example` is tracked.

### Auth setup

1. In the Clerk dashboard, create an OAuth application (public client with PKCE).
2. Add `<API_URL>/auth/callback` as its redirect URI, e.g. `http://localhost:3000/auth/callback`.
3. Put its client ID into `CLERK_OAUTH_CLIENT_ID` and your instance's Frontend API URL into `CLERK_FRONTEND_API`.

### Install and run

```bash
git clone https://github.com/andriikhamarchuk-byteandkite/NightCode.git
cd NightCode
bun install                                          # also generates the Prisma client
bun run --cwd packages/database db:migrate:deploy    # apply migrations
bun run dev:server                                   # terminal 1: API on :3000
bun run dev:cli                                      # terminal 2: TUI
```

Run both from the repo root so Bun picks up `.env`. In the CLI, run `/login` first: every `/sessions` and `/chat` request needs a signed-in user.

`dev:cli` restarts on file changes. Quit with `/exit`.

### `nightcode` command

To run the CLI in any project directory:

```bash
bun run link:cli    # once; registers the `nightcode` command
cd path/to/your/project
nightcode
```

The tools then work on the directory you started `nightcode` in. The command still reads `API_URL` and the Clerk settings from this repo's `.env`, so it can point at a local or deployed server.

`bun link` puts the command in `~/.bun/bin`, which must be on `PATH`. If Bun was installed through npm, also add the folder with `bun.exe` (`%APPDATA%
pm
ode_modulesunin`), because the command looks for `bun.exe` there.

### Type-check

```bash
bun run --cwd packages/cli typecheck
```

## Project structure

```
packages/
├── cli/                  # OpenTUI + React terminal client
│   └── src/
│       ├── index.tsx     # Renderer bootstrap, provider tree, router
│       ├── screens/      # Home, new session, session chat
│       ├── layouts/      # Root layout, route error screen
│       ├── components/   # Input bar (@ mentions), messages, dialogs, command menu, status bar
│       ├── providers/    # Theme, keyboard layers, dialog, toast, prompt config (mode/model)
│       ├── hooks/        # useChat: AI SDK chat, local tool runs, approvals
│       └── lib/          # Typed API client, auth, OAuth login flow, local tool executor
├── server/               # Hono API
│   └── src/
│       ├── index.ts      # App, Sentry, error handler, auth middleware, routes
│       ├── routes/       # /sessions, /chat, /auth/callback
│       ├── middleware/   # requireAuth: verifies the Clerk OAuth token, sets userId
│       └── system-prompt.ts
├── database/             # Prisma schema, migrations, client
└── shared/               # Model list, modes and tool schemas shared by CLI and server
```

## Usage

- Type `/` to open the command menu; navigate with ↑/↓, run with Enter or mouse click, close with Esc.
- `/login` signs in through the browser; `/logout` removes the stored token.
- `/new` starts a session; `/sessions` browses past ones.
- `/models` picks the AI model; `/agents` picks the mode (Plan or Build). `Tab` also toggles the mode.
- Type `@` in the input to autocomplete a file path from the working directory.
- `/theme` opens the theme picker: arrows preview a theme, Enter saves it, Esc reverts.
- `Ctrl+C` closes the top layer first (dialog, command menu), then clears the input, then exits.

Local files: `~/.nightcode/preferences.json` (theme) and `~/.nightcode/auth.json` (OAuth access token, mode `0600`).

## Agent tools and permissions

Tools run in the CLI, on the user's machine, inside the directory the CLI was started from. The server only sends the tool schemas to the model and never executes a tool:

1. The model asks for a tool; the server streams the call to the CLI and ends the request.
2. The CLI runs the tool locally (after approval, if needed) and sends the result back.
3. The server adds the result to the stored message and starts the next model step.

| Tool            | Plan | Build | Approval | Limits |
|-----------------|:----:|:-----:|:--------:|--------|
| `readFile`      | yes  | yes   | no       | Path must stay inside the working directory; optional `offset`/`limit` line range; output truncated at 10,000 chars |
| `listDirectory` | yes  | yes   | no       | Path must stay inside the working directory |
| `grep`          | yes  | yes   | no       | Path must stay inside the working directory; skips dot directories; max 50 matches |
| `glob`          | yes  | yes   | no       | Pattern and results must stay inside the working directory; max 200 results |
| `writeFile`     | no   | yes   | yes      | Path must stay inside the working directory |
| `editFile`      | no   | yes   | yes      | Path must stay inside the working directory; `oldString` must match exactly once |
| `bash`          | no   | yes   | yes      | Runs in the working directory; 30 s default / 120 s max timeout; output truncated at 20,000 chars; env vars matching `KEY`, `TOKEN`, `SECRET`, `PASSWORD` or `DATABASE_URL` are removed |

- **Secret files:** `readFile`, `writeFile`, `editFile`, `glob` and `grep` skip `.env*` (except `.env.example`), `*.pem`, `id_rsa*` and anything under `.git`.

- **Approval:** before a write or shell tool runs, the CLI shows the tool name and its input. Only `y` allows it (Enter does nothing, so typing cannot approve by accident); `n`/Esc/Ctrl+C rejects it. A `bash` command is always shown in full. A rejected call is returned to the model as an error, so it can try another way.
- **Errors:** a failed tool (missing file, path outside the project, non-zero exit code) is returned to the model as its result, and the UI shows the error next to the call.
- **Interrupt:** Esc during a turn stops the stream, kills a running `bash` command with every process it started and closes pending tool calls as interrupted; the turn does not continue on its own.
- **Plan** mode is read-only: the model only gets the read tools, and the CLI also refuses write and shell tools in Plan mode.
- **Trust boundary:** the server keeps the conversation history. The CLI can only add a new user message or fill in results for tool calls that are still waiting; it cannot rewrite earlier messages.
- On Windows, `bash` and `grep` come from Git for Windows (found through `git` on `PATH`), not from the WSL launcher in `System32`. The model is told the OS and to use POSIX commands.
- One turn can use at most 50 model steps; after that the model must answer in text.
- Sessions and chat are scoped to the signed-in Clerk user; another user's session returns 404.

## Scripts

| Command                              | Description                    |
|--------------------------------------|--------------------------------|
| `bun run dev:cli`                    | Start the CLI in watch mode    |
| `bun run dev:server`                 | Start the API server in hot-reload mode |
| `bun run link:cli`                   | Register the global `nightcode` command |
| `bun run --cwd packages/database db:migrate:deploy` | Apply Prisma migrations (run before first `dev:server`) |
| `bun run --cwd packages/cli typecheck` | Run TypeScript type-check    |

`bun install` also generates the Prisma client (`postinstall`).

## Workflow

- `main` is protected by convention: no direct pushes of unreviewed work.
- Every working day: one runnable increment on a feature branch, PR with test/run evidence, peer review, then merge.
- Branch naming: `<clickup-task-id>-<short-description>`.
- PR descriptions follow [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md).

## Known limitations

- `bash` is not sandboxed: once approved, a command can read or change anything the user can. Only env var names that look like secrets are filtered out.
- On Windows, a background process started by a `bash` command (e.g. `cmd &`) can survive a timeout or Esc: Git bash forks break the Windows process tree. The tool still returns after a short wait.
- The file tools resolve paths without following symlinks, so a symlink inside the project can point outside it.
- The `1_session_ui_messages` migration drops the old `Message` table: sessions created before it open with an empty history.
- `/upgrade` and `/usage` show placeholder toasts; billing arrives in section 9.
- The OAuth token is not refreshed: once it expires, the server returns 401, the CLI deletes the token, and you need to `/login` again.
- `bun run dev:cli` reads `.env` from the current directory, so start it from the repo root; the `nightcode` command reads only `API_URL`, `CLERK_FRONTEND_API` and `CLERK_OAUTH_CLIENT_ID` from the repo's `.env`.
- Sessions created before auth (owned by `mock-user`) are no longer visible.
- Theme preview also writes `~/.nightcode/preferences.json` on every highlighted theme (reverted on Esc).
- Dependencies are newer than in the video (`@opentui/*` 0.5.x vs 0.1.x), so some APIs may differ from the recording.
