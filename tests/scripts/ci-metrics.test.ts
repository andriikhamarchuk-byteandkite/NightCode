import { describe, expect, test } from "bun:test";
import { computeStats, renderIntent, type Run, type Tier } from "../../scripts/ci-metrics";

const run = (conclusion: string, n = 0): Run => ({
  conclusion,
  createdAt: `2026-10-0${(n % 9) + 1}T10:00:00Z`,
  headBranch: "feature",
  url: `https://github.com/o/r/actions/runs/${n}`,
  displayTitle: `run ${n}`,
});

const runs = (success: number, failure: number, other: string[] = []) => [
  ...Array.from({ length: success }, (_, i) => run("success", i)),
  ...Array.from({ length: failure }, (_, i) => run("failure", 100 + i)),
  ...other.map((conclusion, i) => run(conclusion, 200 + i)),
];

describe("computeStats", () => {
  test("ignores cancelled and skipped runs", () => {
    const stats = computeStats(runs(8, 2, ["cancelled", "skipped"]), 0.2);
    expect(stats).toMatchObject({ total: 10, failed: 2, rate: 0.2 });
  });

  test("needs enough runs before judging", () => {
    expect(computeStats(runs(1, 3), 0.2).tier).toBe("insufficient-data");
  });

  test.each([
    [9, 1, "ok"] as const, // 10%
    [7, 3, "diagnose"] as const, // 30%: between 1x and 2x the band
    [6, 4, "propose"] as const, // 40%: at 2x the band
  ])("%i passed, %i failed -> %s", (success, failure, tier) => {
    expect(computeStats(runs(success, failure), 0.2).tier).toBe<Tier>(tier);
  });
});

describe("renderIntent", () => {
  test("drafts an intent with the evidence", () => {
    const stats = computeStats(runs(6, 4), 0.2);
    const intent = renderIntent(stats, 0.2, "2026-10-05");

    expect(intent).toStartWith("# Intent:");
    expect(intent).toContain("Status: draft.");
    expect(intent).toContain("4 of the last 10 completed CI runs failed (40%)");
    expect(intent).toContain("https://github.com/o/r/actions/runs/100");
    for (const section of ["Problem", "Constraints", "Acceptance conditions", "Open questions"]) {
      expect(intent).toContain(`## ${section}`);
    }
  });
});
