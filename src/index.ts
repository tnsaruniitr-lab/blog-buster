import { mkdtempSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { auditLoop, BLOG_BUSTER_VERSION } from "./engine/loop.js";
import { loadFromDirectory } from "./input/from-directory.js";
import { loadFromPostObject, type BloggerPost } from "./input/from-post-object.js";
import {
  publish,
  commitRepoCopy,
  defaultLocalRoot,
  type PublishResult,
} from "./output/publisher.js";
import { writeReport } from "./output/disk-writer.js";
import { loadHistory, type PriorRun } from "./output/history.js";
import { buildShakespeerInstructions } from "./output/shakespeer-instructions.js";
import {
  BUILD_INFO,
  VERSION as BUILD_VERSION,
  assertVersion,
  assertAtLeast,
  buildInfoBanner,
} from "./build-info.js";
import type {
  AuditInput,
  AuditReport,
  BuildInfo,
  ParagraphMetric,
  PreflightFinding,
  PriorIssueStatus,
  RejectedPreflightFinding,
  ScoreWeights,
  Verdict,
} from "./types.js";
import type { ShakespeerInstructionsPayload } from "./output/shakespeer-instructions.js";

export const VERSION = BUILD_VERSION;
export { BUILD_INFO, assertVersion, assertAtLeast, buildInfoBanner };

export interface AuditOptions {
  // input (exactly one required)
  sourceDir?: string;
  generatedPost?: BloggerPost;

  // execution
  runLlmLayers?: boolean;
  targetScore?: number;
  scoreWeights?: ScoreWeights;

  // lineage — pass these from your DB to skip the on-disk history scan
  priorRuns?: PriorRun[];
  version?: number;

  // two-witness preflight from shakes-peer's kept checks
  preflight?: PreflightFinding[];

  // publishing
  publishToLocal?: boolean;
  publishToRepo?: boolean;
  commit?: boolean;
  push?: boolean;  // when true and commit is true, runs `git push` after commit

  // paths
  outputDir?: string;
  repoRoot?: string;
  localRoot?: string;
}

export interface AuditHumanSummary {
  verdict: Verdict;
  verdictReason: string;
  topActions: string[];
  tldr: string;
}

export interface AuditResult {
  version: number;
  isFinal: boolean;
  verdict: Verdict;
  verdictReason: string;
  finalScore: number;
  criticalCount: number;
  iterationsCount: number;
  totalCostUsd: number;
  status: AuditReport["status"];
  stopReason: string;
  shakespeerInstructions: ShakespeerInstructionsPayload;
  humanSummary: AuditHumanSummary;
  paragraphMetrics: ParagraphMetric[];
  priorIssues: PriorIssueStatus[];
  regressions: PriorIssueStatus[];
  confirmedFindings: string[];
  rejectedFindings: RejectedPreflightFinding[];
  blogBusterVersion: string;
  buildInfo: BuildInfo;
  scoreWeights: ScoreWeights;
  publishedLocations: PublishResult["locations"];
  fullReport: AuditReport;
}

function resolveRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  return resolve(here, "..");
}

function buildHumanSummary(report: AuditReport): AuditHumanSummary {
  const final = report.iterations[report.iterations.length - 1];
  const findings = final?.findings ?? [];
  const order = { critical: 0, fail: 1, warn: 2, info: 3 } as const;
  const top = [...findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, 5)
    .map((f) => `[${f.severity}] ${f.checkId} — ${f.evidence}`);
  const tldr = `${report.brand} · ${report.postType} · v${report.version}${report.isFinal ? " FINAL" : ""} · score ${report.finalScore}/100 · ${report.criticalCount} critical · ${report.iterations.length} iter · $${report.totalCostUsd.toFixed(3)}`;
  return {
    verdict: report.verdict,
    verdictReason: report.verdictReason,
    topActions: top,
    tldr,
  };
}

export async function audit(opts: AuditOptions): Promise<AuditResult> {
  if (!opts.sourceDir && !opts.generatedPost) {
    throw new Error("audit() requires either sourceDir or generatedPost");
  }

  const callStart = Date.now();
  const input: AuditInput = opts.sourceDir
    ? loadFromDirectory(opts.sourceDir)
    : loadFromPostObject(opts.generatedPost as BloggerPost);

  // Acknowledge-on-invoke: every audit() call leaves a stderr trace. Even
  // when publishToLocal=false and publishToRepo=false (no disk artifacts),
  // this line confirms the call reached blog-buster. See build-info.ts.
  const priorRunsSource = opts.priorRuns !== undefined ? "caller" : "disk-scan";
  const priorRunsCount = opts.priorRuns?.length ?? "?";
  process.stderr.write(
    `[${buildInfoBanner()}] audit() START brand="${input.brand}" slug="${input.slug}" priorRuns=${priorRunsCount} (${priorRunsSource}) runLlmLayers=${opts.runLlmLayers ?? true}\n`,
  );

  const repoRoot = opts.repoRoot ?? resolveRepoRoot();
  const repoAuditRoot = join(repoRoot, "audit-reports");
  const localAuditRoot = opts.localRoot ?? defaultLocalRoot();

  // Lineage: prefer caller-provided priorRuns (Supabase-backed) over the
  // on-disk scan. When both sides are fully integrated, priorRuns comes from
  // audit_lineage and the disk scan is never invoked.
  const priorRuns =
    opts.priorRuns !== undefined
      ? opts.priorRuns
      : loadHistory(repoAuditRoot, input.brand, input.slug);

  const usingExplicitOut = !!opts.outputDir;
  const stagingDir = opts.outputDir
    ? resolve(opts.outputDir)
    : mkdtempSync(join(tmpdir(), "blog-buster-"));

  const runLlmLayers = opts.runLlmLayers ?? true;
  const report = await auditLoop(input, {
    outputDir: stagingDir,
    runLlmLayers,
    priorRuns,
    versionOverride: opts.version,
    preflight: opts.preflight,
    scoreWeights: opts.scoreWeights,
  });

  writeReport(report, stagingDir);

  const publishLocal = opts.publishToLocal ?? !usingExplicitOut;
  const publishRepo = opts.publishToRepo ?? !usingExplicitOut;

  let publishResult: PublishResult = { locations: [] };
  if (publishLocal || publishRepo) {
    publishResult = publish(report, stagingDir, {
      localRoot: publishLocal ? localAuditRoot : undefined,
      repoRoot: publishRepo ? repoAuditRoot : undefined,
    });
  }

  if (opts.commit && publishRepo) {
    const repoLoc = publishResult.locations.find((l) => l.kind === "repo");
    if (repoLoc) {
      commitRepoCopy(repoAuditRoot, repoLoc.relPath, report, { push: opts.push });
    }
  }

  const shakespeerInstructions = buildShakespeerInstructions(
    report,
    opts.targetScore ?? 90,
  );

  const elapsedMs = Date.now() - callStart;
  process.stderr.write(
    `[${buildInfoBanner()}] audit() DONE  brand="${input.brand}" slug="${input.slug}" version=v${report.version}${report.isFinal ? " FINAL" : ""} verdict=${report.verdict} score=${report.finalScore} iters=${report.iterations.length} cost=$${report.totalCostUsd.toFixed(4)} elapsed=${(elapsedMs / 1000).toFixed(1)}s\n`,
  );

  return {
    version: report.version,
    isFinal: report.isFinal,
    verdict: report.verdict,
    verdictReason: report.verdictReason,
    finalScore: report.finalScore,
    criticalCount: report.criticalCount,
    iterationsCount: report.iterations.length,
    totalCostUsd: report.totalCostUsd,
    status: report.status,
    stopReason: report.stopReason,
    shakespeerInstructions,
    humanSummary: buildHumanSummary(report),
    paragraphMetrics: report.paragraphMetrics,
    priorIssues: report.priorIssues,
    regressions: report.priorIssues.filter((p) => p.status === "regressed"),
    confirmedFindings: report.confirmedFindings,
    rejectedFindings: report.rejectedFindings,
    blogBusterVersion: report.blogBusterVersion,
    buildInfo: report.buildInfo,
    scoreWeights: report.scoreWeights,
    publishedLocations: publishResult.locations,
    fullReport: report,
  };
}

export type { BloggerPost } from "./input/from-post-object.js";
export type { PriorRun } from "./output/history.js";
export type {
  AuditReport,
  AuditInput,
  BuildInfo,
  ParagraphMetric,
  PreflightFinding,
  PriorIssueStatus,
  RejectedPreflightFinding,
  ScoreWeights,
  Verdict,
} from "./types.js";
export type {
  ShakespeerInstructionsPayload,
  ShakespeerInstruction,
} from "./output/shakespeer-instructions.js";
