import { relative } from "path";
import { tool } from "ai";
import { z } from "zod";
import { resolveInsideCwd, SECRET_GREP_EXCLUDES } from "./resolve-path";

const MAX_MATCHES = 50;

export function createGrepTool(cwd: string) {
  return tool({
    description:
      "Search file contents using a regex pattern. Returns matching lines with file paths and line numbers. Skips hidden directories, node_modules, and binary files.",
    inputSchema: z.object({
      pattern: z.string().describe("Regex pattern to search for"),
      path: z
        .string()
        .describe("Relative directory to search in (defaults to project root)")
        .default("."),
      include: z
        .string()
        .describe("Glob pattern to filter files (e.g. '*.ts', '*.tsx')")
        .optional(),
    }),
    execute: async ({ pattern, path, include }) => {
      const resolved = resolveInsideCwd(cwd, path);

      if (!resolved) {
        return { error: "Path is outside the project directory" };
      }

      try {
        const args = [
          "-rn",
          "--color=never",
          "--exclude-dir=node_modules",
          "--exclude-dir=.*",
          ...SECRET_GREP_EXCLUDES,
          "-E",
        ];

        if (include) {
          args.push(`--include=${include}`);
        }

        // -e and -- stop a pattern like "-f" being read as a grep option
        args.push("-e", pattern, "--", resolved);

        const proc = Bun.spawn(["grep", ...args], {
          stdout: "pipe",
          stderr: "pipe",
          cwd,
        });

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);

        await proc.exited;

        if (proc.exitCode !== 0 && proc.exitCode !== 1) {
          return { error: `grep failed: ${stderr.trim()}` };
        }

        if (!stdout.trim()) {
          return { matches: [], message: "No matches found" };
        }

        const lines = stdout.trim().split("\n");
        const matches: { file: string; line: number; content: string }[] = [];
        let truncated = false;

        for (const line of lines) {
          if (matches.length >= MAX_MATCHES) {
            truncated = true;
            break;
          }

          // grep output format: /absolute/path:linenum:content
          const match = line.match(/^(.+?):(\d+):(.*)$/);
          if (match) {
            matches.push({
              file: relative(cwd, match[1]!),
              line: parseInt(match[2]!, 10),
              content: match[3]!,
            });
          }
        }

        return {
          matches,
          ...(truncated ? { truncated: true, totalMatches: lines.length } : {}),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to search: ${message}` };
      }
    },
  });
}
