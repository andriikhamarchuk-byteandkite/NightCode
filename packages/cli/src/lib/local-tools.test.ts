import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Mode } from "@nightcode/shared";
import { executeLocalTool } from "./local-tools";

// The tools resolve paths against process.cwd(), so the tests run inside a
// throwaway project directory and never touch the repo.
const originalCwd = process.cwd();
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "nightcode-tools-"));
  await mkdir(join(root, "project"));
  await writeFile(join(root, "outside.txt"), "outside");
  await writeFile(join(root, "project", "notes.txt"), "line 1\nline 2\nline 3");
  await writeFile(join(root, "project", ".env"), "API_KEY=secret");
  await writeFile(join(root, "project", ".env.example"), "API_KEY=");
  await writeFile(join(root, "project", "key.pem"), "-----BEGIN-----");
  await writeFile(join(root, "project", "big.txt"), "x".repeat(10_001));
  process.chdir(join(root, "project"));
});

afterAll(async () => {
  process.chdir(originalCwd);
  await rm(root, { recursive: true, force: true });
});

describe("readFile", () => {
  test("reads a file inside the project", async () => {
    const result = await executeLocalTool(
      "readFile",
      { path: "notes.txt", offset: 2, limit: 1 },
      Mode.BUILD,
    );
    expect(result).toEqual({ content: "line 2" });
  });

  test("rejects a path outside the project", async () => {
    await expect(
      executeLocalTool("readFile", { path: "../outside.txt" }, Mode.BUILD),
    ).rejects.toThrow("outside the project directory");
  });

  test("rejects secret files but allows .env.example", async () => {
    await expect(
      executeLocalTool("readFile", { path: ".env" }, Mode.BUILD),
    ).rejects.toThrow("secret files");
    expect(
      await executeLocalTool("readFile", { path: ".env.example" }, Mode.BUILD),
    ).toEqual({ content: "API_KEY=" });
  });

  test("truncates large files", async () => {
    const result = await executeLocalTool(
      "readFile",
      { path: "big.txt" },
      Mode.BUILD,
    );
    expect(result).toMatchObject({ truncated: true, totalLength: 10_001 });
  });
});

describe("PLAN mode", () => {
  test("refuses write tools", async () => {
    await expect(
      executeLocalTool(
        "writeFile",
        { path: "new.txt", content: "x" },
        Mode.PLAN,
      ),
    ).rejects.toThrow("not available in PLAN mode");
  });
});

describe("glob", () => {
  test("hides secret files from results", async () => {
    const result = await executeLocalTool(
      "glob",
      { pattern: "*" },
      Mode.BUILD,
    );
    expect(result).toEqual({
      files: ["big.txt", "notes.txt"],
    });
  });
});
