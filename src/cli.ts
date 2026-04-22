#!/usr/bin/env node
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { audit } from "./index.js";
import { anthropicApiKey } from "./config.js";

interface Args {
  input: string;
  out?: string;
  noLlm: boolean;
  commit: boolean;
  noLocal: boolean;
  noRepo: boolean;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let input = "";
  let out: string | undefined;
  let noLlm = false;
  let commit = false;
  let noLocal = false;
  let noRepo = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out" || a === "-o") out = args[++i];
    else if (a === "--no-llm") noLlm = true;
    else if (a === "--commit") commit = true;
    else if (a === "--no-publish-local") noLocal = true;
    else if (a === "--no-publish-repo") noRepo = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        `Usage: blog-buster <shakespeer-output-dir> [flags]

  <shakespeer-output-dir>   Path containing full-page.html, metadata.json, etc.

Flags:
  --out <dir>               Override: write staging artifacts to this dir (disables dual-publish)
  --no-llm                  Skip LLM-based layers (deterministic only)
  --commit                  After publishing, git-add + git-commit the repo copy
  --no-publish-local        Skip local publish to ~/Desktop/audits/reports
  --no-publish-repo         Skip repo publish to blog-buster/audit-reports

Default publish targets (version auto-assigned from history):
  Local:  ~/Desktop/audits/reports/<brand>/<slug>/<timestamp>/
  Repo:   <blog-buster>/audit-reports/<brand>/<slug>/<timestamp>/

Versioning:
  - First run for <brand>/<slug> = v1; subsequent runs auto-increment to v2, v3
  - At v3, a FINAL.html is written at the <brand>/<slug>/ level (human-only)

Programmatic use:
  import { audit } from "blog-buster";
  const result = await audit({ generatedPost, runLlmLayers: true });
`,
      );
      process.exit(0);
    } else if (!input) input = a;
  }
  if (!input) {
    console.error("Error: missing input directory. See --help.");
    process.exit(2);
  }
  return { input, out, noLlm, commit, noLocal, noRepo };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  const inputDir = resolve(parsed.input);
  if (!existsSync(inputDir) || !statSync(inputDir).isDirectory()) {
    console.error(`Input is not a directory: ${inputDir}`);
    process.exit(2);
  }
  if (!parsed.noLlm && !anthropicApiKey) {
    console.error("ANTHROPIC_API_KEY is not set. Export it or pass --no-llm.");
    process.exit(2);
  }

  console.log(`blog-buster`);
  console.log(`  input:  ${inputDir}`);
  console.log(`  mode:   ${parsed.noLlm ? "deterministic-only (no LLM)" : "full (LLM judge + rewrites)"}`);

  const result = await audit({
    sourceDir: inputDir,
    runLlmLayers: !parsed.noLlm,
    publishToLocal: !parsed.noLocal && !parsed.out,
    publishToRepo: !parsed.noRepo && !parsed.out,
    commit: parsed.commit,
    outputDir: parsed.out ? resolve(parsed.out) : undefined,
  });

  const verdictBanner =
    result.verdict === "ship"
      ? "\x1b[42;30m SHIP \x1b[0m"
      : result.verdict === "edit"
        ? "\x1b[43;30m EDIT \x1b[0m"
        : "\x1b[41;37m BLOCK \x1b[0m";

  console.log("\n--- Summary ---");
  console.log(`Version:      v${result.version}${result.isFinal ? " (FINAL)" : ""}`);
  console.log(`Verdict:      ${verdictBanner} ${result.verdict.toUpperCase()}`);
  console.log(`Reason:       ${result.verdictReason}`);
  console.log(`Status:       ${result.status}`);
  console.log(`Final score:  ${result.finalScore}  (${result.criticalCount} critical)`);
  console.log(`Iterations:   ${result.iterationsCount}`);
  console.log(`Cost:         $${result.totalCostUsd.toFixed(4)}`);
  console.log(`Stop reason:  ${result.stopReason}`);

  if (result.priorIssues.length) {
    const fixed = result.priorIssues.filter((p) => p.status === "fixed").length;
    const stillPresent = result.priorIssues.filter((p) => p.status === "still_present").length;
    console.log(
      `\nPrior-version diff: ${fixed} fixed · ${stillPresent} still present · ${result.regressions.length} regressed`,
    );
  }

  if (result.publishedLocations.length) {
    console.log("\nPublished:");
    for (const loc of result.publishedLocations) {
      console.log(`  [${loc.kind}] ${loc.path}`);
      console.log(`         index: ${loc.indexPath}`);
    }
  }

  if (result.isFinal) {
    console.log(`\nFINAL report written at <brand>/<slug>/FINAL.html (human-only)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
