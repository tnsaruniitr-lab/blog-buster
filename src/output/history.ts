import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AuditReport, Finding, PriorIssueStatus, Severity } from "../types.js";

function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function severityRank(s: Severity): number {
  return { critical: 4, fail: 3, warn: 2, info: 1 }[s];
}

export interface PriorRun {
  path: string;
  timestamp: string;
  report: AuditReport;
}

export function loadHistory(
  repoRoot: string,
  brand: string,
  slug: string,
): PriorRun[] {
  const base = join(repoRoot, sanitize(brand), sanitize(slug));
  if (!existsSync(base)) return [];
  const tsDirs = readdirSync(base)
    .filter((d) => {
      try {
        return statSync(join(base, d)).isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(d);
      } catch {
        return false;
      }
    })
    .sort();

  const runs: PriorRun[] = [];
  for (const ts of tsDirs) {
    const reportPath = join(base, ts, "report.json");
    if (!existsSync(reportPath)) continue;
    try {
      const report = JSON.parse(readFileSync(reportPath, "utf-8")) as AuditReport;
      runs.push({ path: join(base, ts), timestamp: ts, report });
    } catch {
      // malformed prior report — skip
    }
  }
  return runs;
}

export function diffAgainstPrior(
  previous: Finding[],
  current: Finding[],
): PriorIssueStatus[] {
  const currentByCheck = new Map<string, Finding>();
  for (const f of current) currentByCheck.set(f.checkId, f);

  const statuses: PriorIssueStatus[] = [];
  for (const prev of previous) {
    const cur = currentByCheck.get(prev.checkId);
    if (!cur) {
      statuses.push({
        checkId: prev.checkId,
        severity: prev.severity,
        evidence: prev.evidence,
        status: "fixed",
        previousSeverity: prev.severity,
      });
    } else if (severityRank(cur.severity) > severityRank(prev.severity)) {
      statuses.push({
        checkId: prev.checkId,
        severity: cur.severity,
        evidence: cur.evidence,
        status: "regressed",
        previousSeverity: prev.severity,
      });
    } else {
      statuses.push({
        checkId: prev.checkId,
        severity: cur.severity,
        evidence: cur.evidence,
        status: "still_present",
        previousSeverity: prev.severity,
      });
    }
  }
  return statuses;
}

export function priorFindingsFor(run: PriorRun): Finding[] {
  const final = run.report.iterations[run.report.iterations.length - 1];
  return final?.findings ?? [];
}
