// Control band for CI health (Stage 6: Maintain). A deterministic check reads
// recent CI runs; when the failure rate leaves the band it drafts the next
// intent.md, so a trend turns into planned work instead of a shrug.
//
// Usage:
//   bun scripts/ci-metrics.ts [--threshold 0.2] [--limit 30] [--workflow CI]
//                             [--input runs.json] [--dry-run]

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export type Run = {
  conclusion: string;
  createdAt: string;
  headBranch: string;
  url: string;
  displayTitle: string;
};

export type Tier = "insufficient-data" | "ok" | "diagnose" | "propose";

export type Stats = {
  total: number;
  failed: number;
  rate: number;
  tier: Tier;
  failures: Run[];
};

// Too few runs make the rate noise: one red run out of three is not a trend.
const MIN_RUNS = 5;

export function computeStats(runs: Run[], threshold: number): Stats {
  // Cancelled and skipped runs say nothing about code health.
  const completed = runs.filter((run) =>
    ["success", "failure"].includes(run.conclusion),
  );
  const failures = completed.filter((run) => run.conclusion === "failure");
  const rate = completed.length ? failures.length / completed.length : 0;

  let tier: Tier;
  if (completed.length < MIN_RUNS) tier = "insufficient-data";
  else if (rate < threshold) tier = "ok";
  else if (rate < threshold * 2) tier = "diagnose";
  else tier = "propose";

  return { total: completed.length, failed: failures.length, rate, tier, failures };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function renderIntent(stats: Stats, threshold: number, date: string) {
  const failures = stats.failures
    .slice(0, 10)
    .map((run) => `- [${run.displayTitle}](${run.url}) on \`${run.headBranch}\`, ${run.createdAt.slice(0, 10)}`)
    .join("\n");

  return `# Intent: bring the CI failure rate back inside its band

Author: ci-metrics (draft for a human owner). Status: draft.
Source: \`bun scripts/ci-metrics.ts\` on ${date}.

## Problem

${stats.failed} of the last ${stats.total} completed CI runs failed (${percent(stats.rate)}).
The band is ${percent(threshold)}, and the rate is at least twice that. Red runs
slow every PR down and teach people to ignore CI.

Recent failures:

${failures}

## Proposed outcome

- The CI failure rate is back under ${percent(threshold)} over the next 30 runs.
- Every recurring failure cause has a fix or a test that guards it.

## Affected users and systems

- Users: everyone opening PRs, and the reviewer.
- Systems: \`.github/workflows/ci.yml\` and the packages that the failing runs point to.

## Constraints

- Do not weaken checks, skip tests or loosen \`tsconfig\` to turn CI green.
- The standing constraints in \`CLAUDE.md\` apply (approval gates, no \`.env\`).

## Acceptance conditions

- [ ] \`bun scripts/ci-metrics.ts\` reports tier \`ok\` after the fix lands.
- [ ] Each failure cause above is classified (real, flaky or infra) and handled.

## Open questions

- Are these failures one cause or several? Group them using the triage
  summaries on the failed runs.
- Is any failure flaky (it passes on rerun)? If so, why?
`;
}

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

async function loadRuns(workflow: string, limit: number, input?: string) {
  if (input) return (await Bun.file(input).json()) as Run[];

  // Filtered by name here, not with `gh --workflow`: that flag only finds
  // workflows on the default branch, and stacked PRs run CI before main has it.
  const result = Bun.spawnSync([
    "gh", "run", "list",
    "--limit", String(limit * 4),
    "--json", "conclusion,createdAt,headBranch,url,displayTitle,workflowName",
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`gh run list failed: ${result.stderr.toString().trim()}`);
  }
  const runs = JSON.parse(result.stdout.toString()) as (Run & { workflowName: string })[];
  return runs.filter((run) => run.workflowName === workflow).slice(0, limit);
}

if (import.meta.main) {
  const threshold = Number(arg("threshold", "0.2"));
  const input = process.argv.includes("--input") ? arg("input", "") : undefined;
  const runs = await loadRuns(arg("workflow", "CI"), Number(arg("limit", "30")), input);
  const stats = computeStats(runs, threshold);

  console.log(
    `CI failure rate: ${stats.failed}/${stats.total} (${percent(stats.rate)}), band ${percent(threshold)}, tier: ${stats.tier}`,
  );

  // Tiers from the playbook: log, diagnose (read-only look), propose (new intent).
  if (stats.tier === "diagnose") {
    console.log("Inside 1-2x the band. Look at these failures:");
    for (const run of stats.failures) console.log(`  ${run.url}  ${run.displayTitle}`);
  }

  if (stats.tier === "propose") {
    const date = new Date().toISOString().slice(0, 10);
    const dir = join("docs", "sdlc", `${date}-ci-failures`);
    const file = join(dir, "intent.md");

    if (process.argv.includes("--dry-run")) {
      console.log(`Would write ${file} (dry run).`);
    } else if (existsSync(file)) {
      console.log(`${file} already exists; not overwriting.`);
    } else {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, renderIntent(stats, threshold, date));
      console.log(`Band breached. Drafted ${file} for a human to review.`);
    }
  }
}
