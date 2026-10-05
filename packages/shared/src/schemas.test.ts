/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  MAX_BASH_TIMEOUT,
  Mode,
  getToolContracts,
  modeSchema,
  toolInputSchemas,
} from "./schemas";

describe("modeSchema", () => {
  test("accepts the known modes", () => {
    expect(modeSchema.parse(Mode.BUILD)).toBe(Mode.BUILD);
    expect(modeSchema.parse(Mode.PLAN)).toBe(Mode.PLAN);
  });

  test("rejects an unknown mode", () => {
    expect(modeSchema.safeParse("ADMIN").success).toBe(false);
  });
});

describe("toolInputSchemas", () => {
  test("defaults search paths to the project root", () => {
    expect(toolInputSchemas.listDirectory.parse({}).path).toBe(".");
    expect(toolInputSchemas.glob.parse({ pattern: "*.ts" }).path).toBe(".");
    expect(toolInputSchemas.grep.parse({ pattern: "todo" }).path).toBe(".");
  });

  test("rejects a non-positive readFile range", () => {
    expect(
      toolInputSchemas.readFile.safeParse({ path: "a.ts", offset: 0 }).success,
    ).toBe(false);
    expect(
      toolInputSchemas.readFile.safeParse({ path: "a.ts", limit: -1 }).success,
    ).toBe(false);
  });

  test("caps the bash timeout", () => {
    const { bash } = toolInputSchemas;
    expect(
      bash.safeParse({ command: "ls", timeout: MAX_BASH_TIMEOUT }).success,
    ).toBe(true);
    expect(
      bash.safeParse({ command: "ls", timeout: MAX_BASH_TIMEOUT + 1 }).success,
    ).toBe(false);
  });
});

describe("getToolContracts", () => {
  // PLAN mode is read-only: the model must not even be offered write tools.
  test("offers only read-only tools in PLAN mode", () => {
    expect(Object.keys(getToolContracts(Mode.PLAN)).sort()).toEqual([
      "glob",
      "grep",
      "listDirectory",
      "readFile",
    ]);
  });

  test("adds write and bash tools in BUILD mode", () => {
    const tools = Object.keys(getToolContracts(Mode.BUILD));
    expect(tools).toContain("writeFile");
    expect(tools).toContain("editFile");
    expect(tools).toContain("bash");
  });
});
