// PreToolUse approval gate. Claude Code pipes the tool call as JSON on stdin;
// exit 2 blocks the call and stderr goes back to Claude as the reason.
// The agent may act up to a gate but not pass it: a human passes it by
// starting the session with RELEASE_APPROVAL set.

export type ToolCall = {
  tool_name?: string;
  tool_input?: { command?: unknown; file_path?: unknown };
};

type Env = Record<string, string | undefined>;

// Same secret files the agent tools refuse (cli/src/lib/local-tools.ts).
// The deny-list blocks Read(.env), but not `cat .env` through Bash.
const SECRET_FILE =
  /(^|[\s/\\'"=<>(|;&])(\.env(?!\.example\b)(\.[\w.-]+)?|[\w.-]*\.pem|id_rsa[\w.-]*)(?=$|[\s'")|;&>])/;

const MIGRATION =
  /\bprisma\s+(migrate\s+(deploy|dev|reset|resolve)|db\s+push)\b|\bdb:migrate/;
const GIT_PUSH = /\bgit\s+push\b/;
const PROTECTED_BRANCH = /(^|[\s:])(main|master)(\s|$)/;
const PROD_DEPLOY =
  /\bdeploy\b.*\bprod(uction)?\b|\bprod(uction)?\b.*\bdeploy\b|--prod\b/;
const TEST_FILE = /\.test\.tsx?$/;

// The gates themselves: if the agent could edit these, it could switch a gate
// off or set RELEASE_APPROVAL through settings `env`. Humans edit them by hand.
const GUARD_CONFIG =
  /(^|[\s/'"=<>(|;&])\.claude\/(hooks\/|agents\/|settings(\.local)?\.json)/;
// Shell writes into those files: a redirect or tee aimed at one, or a command
// that changes files. Plain reads (cat, grep, jq) stay allowed.
const SHELL_WRITE =
  /(>>?|\btee\s+(-a\s+)?)\s*["']?[^\s"']*\.claude[\\/](hooks[\\/]|agents[\\/]|settings)|\b(mv|cp|rm|sed\s+-i|perl\s+-\w*i|Set-Content|Out-File)\b/;
const GUARD_CONFIG_REASON =
  "Hooks, agents and Claude settings are guard config: the user edits them by hand. Describe the change and ask the user to make it.";

function currentBranch(cwd?: string) {
  const result = Bun.spawnSync(["git", "branch", "--show-current"], { cwd });
  return result.stdout.toString().trim();
}

// A bare `git push` goes to the current branch's upstream.
function pushesToProtectedBranch(command: string, branch: () => string) {
  const push = command.slice(command.search(GIT_PUSH));
  if (PROTECTED_BRANCH.test(push)) return true;
  const args = push.split(/[;&|]/)[0]!.trim().split(/\s+/).slice(2);
  const refspecs = args.filter((arg) => !arg.startsWith("-"));
  return refspecs.length <= 1 && ["main", "master"].includes(branch());
}

export function checkToolCall(
  call: ToolCall,
  env: Env,
  branch: () => string = () => currentBranch(),
): string | null {
  const approved = Boolean(env.RELEASE_APPROVAL);
  const input = call.tool_input ?? {};

  if (call.tool_name === "Bash" && typeof input.command === "string") {
    const command = input.command;

    if (SECRET_FILE.test(command)) {
      return "Commands that touch .env, *.pem or id_rsa files are not allowed. Use .env.example for variable names.";
    }
    if (
      GUARD_CONFIG.test(command.replaceAll("\\", "/")) &&
      SHELL_WRITE.test(command)
    ) {
      return GUARD_CONFIG_REASON;
    }
    if (approved) return null;
    if (MIGRATION.test(command)) {
      return "DB migrations need human approval. Ask the user to run it, or to restart the session with RELEASE_APPROVAL=1.";
    }
    if (GIT_PUSH.test(command) && pushesToProtectedBranch(command, branch)) {
      return "Pushing to main needs human approval. Push a feature branch and open a PR instead.";
    }
    if (PROD_DEPLOY.test(command)) {
      return "Production deploys need release authorization (RELEASE_APPROVAL).";
    }
  }

  if (
    (call.tool_name === "Edit" || call.tool_name === "Write") &&
    typeof input.file_path === "string"
  ) {
    const path = input.file_path;
    if (SECRET_FILE.test(` ${path}`)) {
      return "Editing secret files is not allowed.";
    }
    if (GUARD_CONFIG.test(path.replaceAll("\\", "/"))) {
      return GUARD_CONFIG_REASON;
    }
    // Bug-fix mode: the failing test is the spec, so fix the code instead.
    if (env.PROTECT_TESTS === "1" && TEST_FILE.test(path)) {
      return "Test files are protected (PROTECT_TESTS=1). Fix the code, not the test.";
    }
  }

  return null;
}

if (import.meta.main) {
  let call: ToolCall;
  try {
    call = JSON.parse(await Bun.stdin.text());
  } catch {
    // A broken gate must not block every tool call; the deny-list still applies.
    console.error("approval-gate: could not parse hook input, allowing.");
    process.exit(0);
  }

  const reason = checkToolCall(call, process.env);
  if (reason) {
    console.error(reason);
    process.exit(2);
  }
}
