import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AuditReport } from "../types.js";
import { renderHtmlReport } from "./report-renderer.js";

export function writeReport(report: AuditReport, dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2), "utf-8");
  writeFileSync(join(dir, "report.html"), renderHtmlReport(report), "utf-8");
}
