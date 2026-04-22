import {
  mkdirSync,
  cpSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";
import type { AuditReport } from "../types.js";
import { renderHtmlReport, renderFinalHumanOnly } from "./report-renderer.js";

function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function timestampSlug(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

function writeFullAudit(
  report: AuditReport,
  destDir: string,
  stagingDir: string,
  postRoot: string,
): void {
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, "report.json"), JSON.stringify(report, null, 2), "utf-8");
  writeFileSync(join(destDir, "report.html"), renderHtmlReport(report), "utf-8");

  const stagedFinal = join(stagingDir, "final");
  if (existsSync(stagedFinal)) {
    cpSync(stagedFinal, join(destDir, "final"), { recursive: true });
  }
  for (const entry of readdirSync(stagingDir)) {
    if (!entry.startsWith("iteration-")) continue;
    const src = join(stagingDir, entry);
    if (statSync(src).isDirectory()) {
      cpSync(src, join(destDir, entry), { recursive: true });
    }
  }

  if (report.isFinal) {
    writeFileSync(join(postRoot, "FINAL.html"), renderFinalHumanOnly(report), "utf-8");
    writeFileSync(
      join(postRoot, "FINAL.json"),
      JSON.stringify(
        {
          brand: report.brand,
          slug: report.slug,
          post_type: report.postType,
          version: report.version,
          verdict: report.verdict,
          verdict_reason: report.verdictReason,
          final_score: report.finalScore,
          critical_count: report.criticalCount,
          version_history: [...report.previousVersions, report.startedAt],
          paragraph_metrics: report.paragraphMetrics,
        },
        null,
        2,
      ),
      "utf-8",
    );
  }
}

function verdictEmoji(v: string): string {
  if (v === "ship") return "✅";
  if (v === "edit") return "✏️";
  return "⛔";
}

function renderIndexRow(report: AuditReport, relPath: string): string {
  const scoreCell = `${report.finalScore}${report.criticalCount > 0 ? ` · ${report.criticalCount}⛔` : ""}`;
  const iter = report.iterations.length;
  const versionCell = `v${report.version}${report.isFinal ? " · FINAL" : ""}`;
  const fixedCell = report.priorIssues.length
    ? `${report.fixedPriorIssueCount}✅ / ${report.unresolvedPriorIssueCount}❌ / ${report.regressedPriorIssueCount}⚠️`
    : "—";
  return `| ${report.startedAt.slice(0, 19)}Z | ${report.brand} | \`${report.slug}\` | ${report.postType} | ${versionCell} | ${verdictEmoji(report.verdict)} ${report.verdict.toUpperCase()} | ${scoreCell} | ${fixedCell} | ${iter} | $${report.totalCostUsd.toFixed(4)} | [view](${relPath}/report.html) |`;
}

const INDEX_HEADER = `# Blog audit reports

Auto-generated history of every audit run by \`blog-buster\`.

Columns: date, brand, post slug, inferred type, version, verdict (✅ SHIP / ✏️ EDIT / ⛔ BLOCK), final score + critical count, prior-diff (fixed/still/regressed), iterations, cost, link.

| Date (UTC) | Brand | Slug | Post type | Version | Verdict | Score · Crit | Prior diff | Iters | Cost | Report |
|---|---|---|---|---|---|---|---|---|---|---|
`;

function updateIndex(baseDir: string, report: AuditReport, relPath: string): void {
  const indexPath = join(baseDir, "INDEX.md");
  const newRow = renderIndexRow(report, relPath);
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, INDEX_HEADER + newRow + "\n", "utf-8");
    return;
  }
  const current = readFileSync(indexPath, "utf-8");
  const headerEndRx = /\|\s*---\s*\|[^\n]*\n/;
  const match = current.match(headerEndRx);
  if (!match) {
    writeFileSync(indexPath, INDEX_HEADER + newRow + "\n", "utf-8");
    return;
  }
  const headerEnd = current.indexOf(match[0]) + match[0].length;
  const header = current.slice(0, headerEnd);
  const rows = current.slice(headerEnd).trim();
  const updated = header + newRow + (rows ? "\n" + rows : "") + "\n";
  writeFileSync(indexPath, updated, "utf-8");
}

export interface PublishTargets {
  localRoot?: string;
  repoRoot?: string;
}

export interface PublishResult {
  locations: {
    kind: "local" | "repo";
    path: string;
    indexPath: string;
    relPath: string;
  }[];
}

export function defaultLocalRoot(): string {
  return join(homedir(), "Desktop", "audits", "reports");
}

export function publish(
  report: AuditReport,
  stagingDir: string,
  targets: PublishTargets,
): PublishResult {
  const ts = timestampSlug(report.startedAt);
  const brand = sanitize(report.brand);
  const slug = sanitize(report.slug);
  const relPath = `${brand}/${slug}/${ts}`;

  const locations: PublishResult["locations"] = [];

  const runs: { kind: "local" | "repo"; base: string }[] = [];
  if (targets.localRoot) runs.push({ kind: "local", base: targets.localRoot });
  if (targets.repoRoot) runs.push({ kind: "repo", base: targets.repoRoot });

  for (const run of runs) {
    const fullDest = join(run.base, relPath);
    const postRoot = join(run.base, brand, slug);
    writeFullAudit(report, fullDest, stagingDir, postRoot);
    updateIndex(run.base, report, relPath);
    locations.push({
      kind: run.kind,
      path: fullDest,
      indexPath: join(run.base, "INDEX.md"),
      relPath,
    });
  }

  return { locations };
}

export function commitRepoCopy(repoRoot: string, relPath: string, report: AuditReport): void {
  const gitDir = findGitRoot(repoRoot);
  if (!gitDir) {
    console.warn(`[publisher] no git repo found at or above ${repoRoot}; skipping commit`);
    return;
  }
  const addPathRel = relative(gitDir, join(repoRoot, relPath));
  const indexPathRel = relative(gitDir, join(repoRoot, "INDEX.md"));
  const paths = [addPathRel, indexPathRel];
  if (report.isFinal) {
    const postRoot = relPath.split("/").slice(0, 2).join("/");
    paths.push(
      relative(gitDir, join(repoRoot, postRoot, "FINAL.html")),
      relative(gitDir, join(repoRoot, postRoot, "FINAL.json")),
    );
  }
  const msg = `blog-buster: ${report.brand}/${report.slug} v${report.version}${report.isFinal ? " FINAL" : ""} ${report.verdict} (${report.finalScore})`;
  try {
    execSync(`git -C "${gitDir}" add ${paths.map((p) => `"${p}"`).join(" ")}`, { stdio: "inherit" });
    execSync(`git -C "${gitDir}" commit -m ${JSON.stringify(msg)}`, { stdio: "inherit" });
  } catch (err) {
    console.warn(`[publisher] git commit failed:`, (err as Error).message);
  }
}

function findGitRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
