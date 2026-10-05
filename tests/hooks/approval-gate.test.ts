import { describe, expect, test } from "bun:test";
import { join } from "path";
import { checkToolCall } from "../../.claude/hooks/approval-gate";

const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });
const edit = (file_path: string) => ({ tool_name: "Edit", tool_input: { file_path } });
const onBranch = (name: string) => () => name;
const feature = onBranch("869f1am8w-ai-native-sdlc");

describe("Bash gate", () => {
  test.each([
    "bun run typecheck",
    "bun test",
    "git status",
    "git push -u origin HEAD",
    "git push origin 869f1am8w-ai-native-sdlc",
    "cat .env.example",
    "bun run --cwd packages/database db:generate",
    "gh pr view 12",
  ])("allows %p", (command) => {
    expect(checkToolCall(bash(command), {}, feature)).toBeNull();
  });

  test.each([
    "cat .env",
    "head -5 ./.env.local",
    "grep KEY .env",
    "source .env && bun run dev:server",
    "less packages/server/server.pem",
    "cp ~/.ssh/id_rsa /tmp",
  ])("always blocks secret file access: %p", (command) => {
    expect(checkToolCall(bash(command), { RELEASE_APPROVAL: "1" }, feature)).toContain("not allowed");
  });

  test.each([
    "bun run --cwd packages/database db:migrate:deploy",
    "bunx prisma migrate deploy",
    "cd packages/database && bunx prisma migrate reset --force",
    "bunx prisma db push",
    "git push origin main",
    "git push origin HEAD:main",
    "git fetch && git push origin master",
    "bun run deploy --env production",
    "vercel deploy --prod",
  ])("blocks %p without approval", (command) => {
    expect(checkToolCall(bash(command), {}, feature)).not.toBeNull();
  });

  test("allows a gated command once a human sets RELEASE_APPROVAL", () => {
    expect(
      checkToolCall(bash("bunx prisma migrate deploy"), { RELEASE_APPROVAL: "1" }, feature),
    ).toBeNull();
  });

  test("blocks a bare push while on main", () => {
    expect(checkToolCall(bash("git push"), {}, onBranch("main"))).toContain("main");
    expect(checkToolCall(bash("git push"), {}, feature)).toBeNull();
  });
});

describe("Edit/Write gate", () => {
  test("always blocks secret files", () => {
    expect(checkToolCall(edit("D:/repo/.env"), {})).not.toBeNull();
    expect(checkToolCall(edit("D:/repo/.env.example"), {})).toBeNull();
  });

  test("protects test files only in PROTECT_TESTS mode", () => {
    const file = "packages/shared/src/schemas.test.ts";
    expect(checkToolCall(edit(file), {})).toBeNull();
    expect(checkToolCall(edit(file), { PROTECT_TESTS: "1" })).toContain("Fix the code");
    expect(checkToolCall(edit("packages/shared/src/schemas.ts"), { PROTECT_TESTS: "1" })).toBeNull();
  });
});

describe("hook process", () => {
  const run = (stdin: string) =>
    Bun.spawnSync(["bun", join(import.meta.dir, "../../.claude/hooks/approval-gate.ts")], {
      stdin: Buffer.from(stdin),
      env: { ...process.env, RELEASE_APPROVAL: "" },
    });

  test("exits 2 with a reason on stderr when blocking", () => {
    const result = run(JSON.stringify(bash("git push origin main")));
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("human approval");
  });

  test("exits 0 for an allowed call", () => {
    expect(run(JSON.stringify(bash("bun test"))).exitCode).toBe(0);
  });

  test("fails open on invalid input", () => {
    expect(run("not json").exitCode).toBe(0);
  });
});
