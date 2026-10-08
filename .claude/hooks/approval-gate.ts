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
// The deny-list blocks Read(.env), but not `cat .env` through Bash. Glob
// characters count as a boundary too, so `cat .env*` is caught.
const SECRET_FILE =
  /(^|[\s/\\'"=<>(|;&])(\.env(?!\.example\b)(\.[\w.-]+)?|[\w.-]*\.pem|id_rsa[\w.-]*)(?=$|[\s'")|;&>*?[\]])/;

const MIGRATION =
  /\bprisma\s+(migrate\s+(deploy|dev|reset|resolve)|db\s+push)\b|\bdb:migrate/;
const PROTECTED_BRANCHES = ["main", "master"];
const PROD_DEPLOY =
  /\bdeploy\b.*\bprod(uction)?\b|\bprod(uction)?\b.*\bdeploy\b|--prod\b/;
const TEST_FILE = /\.test\.tsx?$/;

// The gates themselves: if the agent could edit these, it could switch a gate
// off or set RELEASE_APPROVAL through settings `env`. bunfig.toml is here
// because a `preload` in it runs before this hook and could exit 0 early.
// Humans edit all of them by hand.
const GUARD_PATH = String.raw`(\.claude[\\/](hooks[\\/]|agents[\\/]|settings)|\.?bunfig\.toml)`;
const GUARD_CONFIG = new RegExp(String.raw`(^|[\s/\\'"=<>(|;&])` + GUARD_PATH);
// Shell writes into those files: a redirect or tee aimed at one, or a command
// or interpreter call that changes files. Plain reads (cat, grep, jq) stay allowed.
const SHELL_WRITE = new RegExp(
  String.raw`(>>?|\btee\s+(-a\s+)?)\s*["']?[^\s"']*` + GUARD_PATH +
    String.raw`|\b(mv|cp|rm|sed\s+-i|perl\s+-\w*i|Set-Content|Out-File|Bun\.write|(write|append)File(Sync)?)\b`,
);
const GUARD_CONFIG_REASON =
  "Hooks, agents, Claude settings and bunfig.toml are guard config: the user edits them by hand. Describe the change and ask the user to make it.";

function currentBranch(cwd?: string) {
  const result = Bun.spawnSync(["git", "branch", "--show-current"], { cwd });
  return result.stdout.toString().trim();
}

// Checks every `git ... push` in the command, so chaining (`;`, `&&`, `|`) and
// git global options (`git -C . push`) don't hide a push to main.
function pushesToProtectedBranch(command: string, branch: () => string) {
  return command.split(/[;&|]+/).some((segment) => {
    const tokens = segment.trim().split(/\s+/);
    const git = tokens.indexOf("git");
    const push = tokens.indexOf("push", git + 1);
    if (git === -1 || push === -1) return false;

    const flags = tokens.slice(push + 1).filter((arg) => arg.startsWith("-"));
    if (flags.some((flag) => ["--all", "--mirror"].includes(flag))) return true;

    // First positional is the remote; the rest are refspecs.
    const refspecs = tokens.slice(push + 1).filter((arg) => !arg.startsWith("-")).slice(1);
    // No refspec pushes the current branch.
    if (refspecs.length === 0) return PROTECTED_BRANCHES.includes(branch());

    return refspecs.some((refspec) => {
      const target = refspec.split(":").at(-1)!.replace(/^\+/, "").replace(/^refs\/heads\//, "");
      const resolved = target === "HEAD" || target === "@" ? branch() : target;
      return PROTECTED_BRANCHES.includes(resolved);
    });
  });
}

export function checkToolCall(
  call: ToolCall,
  env: Env,
  branch: () => string = () => currentBranch(),
): string | null {
  // Only an explicit yes opens the gates: RELEASE_APPROVAL=0 must not.
  const approved = /^(1|true|yes)$/i.test(env.RELEASE_APPROVAL ?? "");
  const input = call.tool_input ?? {};

  if (call.tool_name === "Bash" && typeof input.command === "string") {
    const command = input.command;

    if (SECRET_FILE.test(command)) {
      return "Commands that touch .env, *.pem or id_rsa files are not allowed. Use .env.example for variable names.";
    }
    if (GUARD_CONFIG.test(command) && SHELL_WRITE.test(command)) {
      return GUARD_CONFIG_REASON;
    }
    if (approved) return null;
    if (MIGRATION.test(command)) {
      return "DB migrations need human approval. Ask the user to run it, or to restart the session with RELEASE_APPROVAL=1.";
    }
    if (pushesToProtectedBranch(command, branch)) {
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
    if (GUARD_CONFIG.test(` ${path}`)) {
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
