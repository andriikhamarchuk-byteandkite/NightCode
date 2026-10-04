import { existsSync } from "fs";
import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "path";
import { toolInputSchemas, Mode, type ModeType } from "@nightcode/shared";

const MAX_FILE_SIZE = 10_000;
const MAX_RESULTS = 200;
const MAX_MATCHES = 50;
const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT = 30_000;

// Read-only tools run without approval and their output goes to the model,
// so files that usually hold credentials are never read or written.
const SECRET_FILE_PATTERN = /^(\.env(\..*)?|.*\.pem|id_rsa.*)$/;
const SECRET_GREP_EXCLUDES = [
  "--exclude=.env*",
  "--exclude=*.pem",
  "--exclude=id_rsa*",
];

// bin/nightcode loads the repo .env, so the server keys can be in this
// process. The shell command must not see them.
const SECRET_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL/i;

function isOutsideCwd(rel: string) {
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

function resolveInsideCwd(path: string) {
  const cwd = process.cwd();
  const resolved = resolve(cwd, path);

  if (isOutsideCwd(relative(cwd, resolved))) {
    throw new Error("Path is outside the project directory");
  }

  return { cwd, resolved };
}

function isSecretPath(cwd: string, path: string) {
  const name = basename(path);
  const isSecretFile =
    name !== ".env.example" && SECRET_FILE_PATTERN.test(name);
  return isSecretFile || relative(cwd, path).split(sep).includes(".git");
}

function resolveAllowedFile(path: string) {
  const result = resolveInsideCwd(path);
  if (isSecretPath(result.cwd, result.resolved)) {
    throw new Error("Access to secret files is not allowed");
  }
  return result;
}

function getSafeEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !SECRET_ENV_PATTERN.test(name),
    ),
  );
}

// Kills the command together with everything it started. Killing only the
// shell would leave e.g. a dev server running and holding the output pipes.
function killProcessTree(pid: number) {
  try {
    if (process.platform === "win32") {
      Bun.spawnSync(["taskkill", "/pid", String(pid), "/T", "/F"]);
    } else {
      // The shell is spawned detached, so it leads its own process group.
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Already exited.
  }
}

// git.exe lives in <root>\cmd, <root>\bin or <root>\mingw64\bin, so walk up
// until the directory that holds Git's own bin\bash.exe.
function findGitForWindowsRoot() {
  const git = Bun.which("git");
  if (!git) return null;

  for (let dir = dirname(git); dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, "bin", "bash.exe"))) return dir;
  }

  return null;
}

let unixTools: { bash: string; grep: string } | undefined;

// On Windows the first "bash" on PATH is often System32\bash.exe, the WSL
// launcher, which fails on every command without an installed distro. Git
// for Windows ships a real bash and grep, so they are taken from there.
// bin\bash.exe (not usr\bin) puts Git's coreutils on PATH for the command.
function getUnixTools() {
  if (unixTools) return unixTools;

  const gitRoot =
    process.platform === "win32" ? findGitForWindowsRoot() : null;
  unixTools = gitRoot
    ? {
        bash: join(gitRoot, "bin", "bash.exe"),
        grep: join(gitRoot, "usr", "bin", "grep.exe"),
      }
    : { bash: "bash", grep: "grep" };

  return unixTools;
}

// Collects into an array instead of returning the text, so a caller that
// stops waiting still gets the output read so far.
async function collectText(
  stream: ReadableStream<Uint8Array>,
  chunks: string[],
) {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    chunks.push(decoder.decode(chunk, { stream: true }));
  }
  chunks.push(decoder.decode());
}

function truncate(value: string, limit: number) {
  return value.length > limit
    ? `${value.slice(0, limit)}\n... (truncated, ${value.length} total chars)`
    : value;
}

export async function executeLocalTool(
  toolName: string,
  input: unknown,
  mode: ModeType,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();

  if (
    mode === Mode.PLAN &&
    !["readFile", "listDirectory", "glob", "grep"].includes(toolName)
  ) {
    throw new Error(`Tool ${toolName} is not available in PLAN mode`);
  }

  switch (toolName) {
    case "readFile": {
      const { path, offset, limit } = toolInputSchemas.readFile.parse(input);
      const { resolved } = resolveAllowedFile(path);
      let content = await readFile(resolved, "utf-8");

      // A line range lets the model read past the size limit in chunks.
      if (offset !== undefined || limit !== undefined) {
        const start = (offset ?? 1) - 1;
        const lines = content.split("\n");
        content = lines
          .slice(start, limit === undefined ? undefined : start + limit)
          .join("\n");
      }

      return content.length > MAX_FILE_SIZE
        ? {
            content: content.slice(0, MAX_FILE_SIZE),
            truncated: true,
            totalLength: content.length,
          }
        : { content };
    }
    case "listDirectory": {
      const { path } = toolInputSchemas.listDirectory.parse(input);
      const { cwd, resolved } = resolveInsideCwd(path);
      const entries = await readdir(resolved);
      const results: { name: string; type: "file" | "directory" }[] = [];

      for (const entry of entries) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const info = await stat(join(resolved, entry));
        results.push({
          name: entry,
          type: info.isDirectory() ? "directory" : "file",
        });
      }

      results.sort((a, b) =>
        a.type !== b.type
          ? a.type === "directory"
            ? -1
            : 1
          : a.name.localeCompare(b.name),
      );
      return { path: relative(cwd, resolved) || ".", entries: results };
    }
    case "glob": {
      const { pattern, path } = toolInputSchemas.glob.parse(input);
      if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) {
        throw new Error("Pattern must stay inside the project directory");
      }
      const { cwd, resolved } = resolveInsideCwd(path);
      const glob = new Bun.Glob(pattern);
      const files: string[] = [];
      let truncated = false;

      for await (const match of glob.scan({
        cwd: resolved,
        dot: false,
        onlyFiles: true,
      })) {
        if (match.split(/[\\/]/).includes("node_modules")) continue;
        const absoluteMatch = resolve(resolved, match);
        if (
          isOutsideCwd(relative(cwd, absoluteMatch)) ||
          isSecretPath(cwd, absoluteMatch)
        ) {
          continue;
        }
        if (files.length >= MAX_RESULTS) {
          truncated = true;
          break;
        }
        files.push(relative(cwd, absoluteMatch));
      }

      files.sort();
      return { files, ...(truncated ? { truncated: true } : {}) };
    }
    case "grep": {
      const { pattern, path, include } = toolInputSchemas.grep.parse(input);
      const { cwd, resolved } = resolveInsideCwd(path);
      const args = [
        "-rn",
        "--color=never",
        "--exclude-dir=node_modules",
        "--exclude-dir=.*",
        ...SECRET_GREP_EXCLUDES,
        "-E",
      ];
      if (include) args.push(`--include=${include}`);
      // -e and -- keep a pattern starting with "-" from being read as a flag.
      args.push("-e", pattern, "--", resolved);

      const proc = Bun.spawn([getUnixTools().grep, ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;

      if (exitCode !== 0 && exitCode !== 1)
        throw new Error(`grep failed: ${stderr.trim()}`);
      if (!stdout.trim()) return { matches: [], message: "No matches found" };

      const lines = stdout.trim().split("\n");
      const matches: { file: string; line: number; content: string }[] = [];
      let truncated = false;

      for (const line of lines) {
        if (matches.length >= MAX_MATCHES) {
          truncated = true;
          break;
        }
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match) {
          matches.push({
            file: relative(cwd, match[1]!),
            line: Number(match[2]),
            content: match[3]!,
          });
        }
      }

      return {
        matches,
        ...(truncated ? { truncated: true, totalMatches: lines.length } : {}),
      };
    }
    case "writeFile": {
      const { path, content } = toolInputSchemas.writeFile.parse(input);
      const { cwd, resolved } = resolveAllowedFile(path);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf-8");
      return {
        success: true as const,
        path: relative(cwd, resolved),
        bytesWritten: Buffer.byteLength(content, "utf-8"),
      };
    }
    case "editFile": {
      const { path, oldString, newString } =
        toolInputSchemas.editFile.parse(input);
      const { cwd, resolved } = resolveAllowedFile(path);
      const content = await readFile(resolved, "utf-8");
      const occurrences = content.split(oldString).length - 1;

      if (occurrences === 0) throw new Error("oldString not found in file");
      if (occurrences > 1)
        throw new Error(`oldString is ambiguous; found ${occurrences} matches`);

      await writeFile(resolved, content.replace(oldString, () => newString), "utf-8");
      return { success: true as const, path: relative(cwd, resolved) };
    }
    case "bash": {
      const { command, timeout = DEFAULT_TIMEOUT } =
        toolInputSchemas.bash.parse(input);
      const proc = Bun.spawn([getUnixTools().bash, "-c", command], {
        cwd: resolveInsideCwd(".").resolved,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...getSafeEnv(), TERM: "dumb" },
        detached: process.platform !== "win32",
      });
      let killed = false;
      let timedOut = false;
      const kill = () => {
        killed = true;
        killProcessTree(proc.pid);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeout);
      signal?.addEventListener("abort", kill, { once: true });

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      const output = Promise.all([
        collectText(proc.stdout, stdoutChunks),
        collectText(proc.stderr, stderrChunks),
      ]);
      const exitCode = await proc.exited;
      // On Windows Git bash forks break the process tree, so a background
      // child can survive the kill and keep the pipes open. After a kill the
      // output is waited for only briefly, so the tool still returns.
      await (killed ? Promise.race([output, Bun.sleep(1000)]) : output);
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      return {
        stdout: truncate(stdoutChunks.join(""), MAX_OUTPUT),
        stderr: truncate(stderrChunks.join(""), MAX_OUTPUT),
        exitCode,
        ...(timedOut ? { timedOut: true } : {}),
      };
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
