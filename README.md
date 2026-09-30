# NightCode

Personal build of **NightCode** — an AI coding agent app — following the free NightCode build video:
https://www.youtube.com/watch?v=k_D_C3ExypU

Built as part of the Byte&Kite internship (Track A). Each video section is delivered as a separate ClickUp ticket with a reviewed pull request.

## Roadmap

Sections from the video, with source timestamps and time budgets (38h total):

| #  | Section                           | Timestamp | Budget | Status  |
|----|-----------------------------------|-----------|--------|---------|
| 0  | Project Setup & Components        | 0:07:38   | —      | review  |
| 1  | UI Infrastructure                 | 1:16:14   | 4h     | todo    |
| 2  | Routing & Screen Layout           | 2:51:25   | 3h     | todo    |
| 3  | Server, Shared Package & Database | 3:25:56   | 5h     | todo    |
| 4  | Sentry Monitoring                 | 5:08:06   | 1h     | todo    |
| 5  | AI Chat Streaming                 | 5:26:13   | 6h     | todo    |
| 6  | Session Management                | 7:04:20   | 4h     | todo    |
| 7  | Tool Calling                      | 7:39:58   | 5h     | todo    |
| 8  | Completing The User Experience    | 8:53:05   | 3h     | todo    |
| 9  | Usage Based Billing               | 10:02:57  | 2h     | todo    |
| 10 | Client-Side Tool Execution        | 10:36:27  | 5h     | todo    |

## Tech stack

- [Bun](https://bun.sh) — runtime, package manager, workspaces
- [OpenTUI](https://github.com/sst/opentui) + React 19 — terminal UI
- TypeScript (strict)

## Getting started

### Prerequisites

- Bun >= 1.3 (tested with 1.4.2)
- A terminal with true-color support (Windows Terminal, iTerm2, etc.)

### Install and run

```bash
git clone https://github.com/andriikhamarchuk-byteandkite/NightCode.git
cd NightCode
bun install
bun run dev:cli
```

`dev:cli` starts the CLI in watch mode; it restarts on file changes. Quit with `/exit`.

### Type-check

```bash
bun run --cwd packages/cli typecheck
```

## Project structure

```
packages/
└── cli/                          # OpenTUI + React terminal client
    └── src/
        ├── index.tsx             # Renderer bootstrap and root App
        └── components/
            ├── header.tsx        # ASCII "NightCode" logo
            ├── input-bar.tsx     # Prompt textarea, submit handling
            ├── status-bar.tsx    # Mode and model indicator
            └── command-menu/     # Slash-command menu (/new, /models, /exit, ...)
```

## Scripts

| Command                              | Description                    |
|--------------------------------------|--------------------------------|
| `bun run dev:cli`                    | Start the CLI in watch mode    |
| `bun run --cwd packages/cli typecheck` | Run TypeScript type-check    |

## Workflow

- `main` is protected by convention: no direct pushes of unreviewed work.
- Every working day: one runnable increment on a feature branch, PR with test/run evidence, peer review, then merge.
- Branch naming: `<clickup-task-id>-<short-description>`.
- PR descriptions follow [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md).

## Known limitations

- Only `/exit` is functional; other slash commands insert their text into the input for now.
- Submitting a prompt does nothing yet — the AI backend arrives in later sections.
- The status bar shows a hard-coded mode and model.
- Dependencies are newer than in the video (`@opentui/*` 0.5.x vs 0.1.x), so some APIs may differ from the recording.
