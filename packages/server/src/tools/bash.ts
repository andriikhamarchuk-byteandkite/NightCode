import { tool } from "ai";
import { z } from "zod";

const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;
const SECRET_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL/i;

// The model controls the command, so it must not be able to print our API keys.
function getSafeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { TERM: "dumb" };
  for (const [name, value] of Object.entries(process.env)) {
    if (name !== "TERM" && !SECRET_ENV_PATTERN.test(name)) {
      env[name] = value;
    }
  }
  return env;
}

export function createBashTool(cwd: string) {
  return tool({
    description:
      "Execute a shell command in the project directory. Use this for running tests, builds, git operations, package installs, and any other shell commands.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to execute"),
      timeout: z
        .number()
        .int()
        .positive()
        .max(MAX_TIMEOUT)
        .describe("Timeout in milliseconds (default: 30000, max: 120000)")
        .default(DEFAULT_TIMEOUT),
    }),
    execute: async ({ command, timeout }) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;

      try {
        const proc = Bun.spawn(["bash", "-c", command], {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          env: getSafeEnv(),
        });

        timer = setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, timeout);

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);

        const exitCode = await proc.exited;

        const truncate = (s: string) =>
          s.length > MAX_OUTPUT
            ? s.slice(0, MAX_OUTPUT) + `\n... (truncated, ${s.length} total chars)`
            : s;

        return {
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          exitCode,
          ...(timedOut ? { timedOut: true } : {}),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to execute command: ${message}` };
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
