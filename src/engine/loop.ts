import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import type {
  AuditInput,
  AuditIteration,
  AuditReport,
  Finding,
  LayerScores,
  PreflightFinding,
  RejectedPreflightFinding,
  ScoreWeights,
} from "../types.js";
import { runTechnicalLayer } from "../layers/technical/index.js";
import { runEeatLayer } from "../layers/eeat/index.js";
import { runHumanizationLayer } from "../layers/humanization/index.js";
import { runQualityLayer } from "../layers/quality/index.js";
import {
  composeScores,
  countCritical,
  deriveVerdict,
  scoreTechnical,
} from "./scorer.js";
import { planPatches } from "./rewriter.js";
import { applyPatches } from "./patcher.js";
import { computeParagraphMetrics } from "../layers/paragraph-metrics.js";
import type { PriorRun } from "../output/history.js";
import { diffAgainstPrior, priorFindingsFor } from "../output/history.js";
import { reconcilePreflight } from "../output/preflight.js";

export const BLOG_BUSTER_VERSION = "0.1.1";

export interface LoopOptions {
  outputDir: string;
  runLlmLayers: boolean;
  priorRuns: PriorRun[];
  versionOverride?: number;
  preflight?: PreflightFinding[];
  scoreWeights?: ScoreWeights;
}

interface LayerResult {
  findings: Finding[];
  scores: LayerScores;
  cost: number;
  confirmed: string[];
  rejected: RejectedPreflightFinding[];
}

async function runAllLayers(
  input: AuditInput,
  runLlm: boolean,
  preflight: PreflightFinding[],
  weights: ScoreWeights | undefined,
): Promise<LayerResult> {
  const technicalFindings = runTechnicalLayer(input);
  const eeatFindings = runEeatLayer(input);
  const human = await runHumanizationLayer(input, { runJudge: runLlm });
  const quality = await runQualityLayer(input, { runJudge: runLlm });
  const technicalAndEeat = [...technicalFindings, ...eeatFindings];
  const ourFindings = [...technicalAndEeat, ...human.findings, ...quality.findings];

  const { preflightAsFindings, confirmed, rejected } = reconcilePreflight(
    preflight,
    ourFindings,
  );

  const scores = composeScores(
    scoreTechnical(technicalAndEeat),
    human.score,
    quality.score,
    weights,
  );

  return {
    findings: [...ourFindings, ...preflightAsFindings],
    scores,
    cost: human.cost + quality.cost,
    confirmed,
    rejected,
  };
}

function writeIterationArtifacts(
  dir: string,
  iter: AuditIteration,
  input: AuditInput,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "full-page.html"), input.html, "utf-8");
  writeFileSync(join(dir, "findings.json"), JSON.stringify(iter.findings, null, 2), "utf-8");
  writeFileSync(
    join(dir, "scores.json"),
    JSON.stringify(
      { iteration: iter.iteration, scores: iter.layerScores, delta: iter.delta },
      null,
      2,
    ),
    "utf-8",
  );
}

export async function auditLoop(
  initialInput: AuditInput,
  opts: LoopOptions,
): Promise<AuditReport> {
  const startedAt = new Date().toISOString();
  const iterations: AuditIteration[] = [];
  let current = initialInput;
  let totalCost = 0;
  let prevOverall = 0;
  let stopReason = "";
  let status: AuditReport["status"] = "shipped";

  let lastConfirmed: string[] = [];
  let lastRejected: RejectedPreflightFinding[] = [];
  const preflight = opts.preflight ?? [];
  const weights = opts.scoreWeights;

  mkdirSync(opts.outputDir, { recursive: true });

  for (let i = 0; i <= config.maxIterations; i++) {
    const iterStart = Date.now();
    const { findings, scores, cost, confirmed, rejected } = await runAllLayers(
      current,
      opts.runLlmLayers,
      preflight,
      weights,
    );
    totalCost += cost;
    lastConfirmed = confirmed;
    lastRejected = rejected;

    const iterDir = join(opts.outputDir, `iteration-${i}`);
    const iter: AuditIteration = {
      iteration: i,
      layerScores: scores,
      findings,
      rewritesApplied: [],
      delta: i === 0 ? 0 : scores.overall - prevOverall,
      htmlSnapshotPath: join(iterDir, "full-page.html"),
      elapsedMs: Date.now() - iterStart,
      costUsd: cost,
    };

    if (scores.overall >= config.targetScore) {
      writeIterationArtifacts(iterDir, iter, current);
      iterations.push(iter);
      stopReason = `Reached target score ${scores.overall} >= ${config.targetScore}`;
      status = "shipped";
      break;
    }

    const unfixableCriticals = findings.filter(
      (f) => f.severity === "critical" && !f.suggestedPatch,
    );
    if (unfixableCriticals.length > 0) {
      writeIterationArtifacts(iterDir, iter, current);
      iterations.push(iter);
      stopReason = `${unfixableCriticals.length} critical finding(s) have no auto-fix (${unfixableCriticals
        .slice(0, 3)
        .map((f) => f.checkId)
        .join(", ")}) — human edit required`;
      status = "escalated";
      break;
    }

    if (i >= config.maxIterations) {
      writeIterationArtifacts(iterDir, iter, current);
      iterations.push(iter);
      stopReason = `Hit max iterations (${config.maxIterations}) with score ${scores.overall}`;
      status = "escalated";
      break;
    }

    if (totalCost > config.costCapUsd) {
      writeIterationArtifacts(iterDir, iter, current);
      iterations.push(iter);
      stopReason = `Cost cap exceeded ($${totalCost.toFixed(3)} > $${config.costCapUsd})`;
      status = "budget_exceeded";
      break;
    }

    if (iterations.length >= 2) {
      const last = iterations[iterations.length - 1];
      if (last.delta < 2 && iter.delta < 2) {
        writeIterationArtifacts(iterDir, iter, current);
        iterations.push(iter);
        stopReason = `Stalled: last two deltas < 2 (${last.delta}, ${iter.delta})`;
        status = "stalled";
        break;
      }
    }

    const plan = await planPatches(findings);
    if (!plan.patches.length) {
      writeIterationArtifacts(iterDir, iter, current);
      iterations.push(iter);
      stopReason = `No actionable patches planned at score ${scores.overall}`;
      status = "stalled";
      break;
    }

    const { input: nextInput, application } = await applyPatches(current, plan.patches);
    totalCost += application.costUsd;
    iter.rewritesApplied = application.applied;
    writeIterationArtifacts(iterDir, iter, current);
    iterations.push(iter);

    if (!application.applied.length) {
      stopReason = `All ${application.rejected.length} patches rejected at iteration ${i}`;
      status = "stalled";
      break;
    }

    prevOverall = scores.overall;
    current = nextInput;
  }

  const finalIter = iterations[iterations.length - 1];
  const finalHtmlPath = join(opts.outputDir, "final", "full-page.html");
  mkdirSync(join(opts.outputDir, "final"), { recursive: true });
  writeFileSync(finalHtmlPath, current.html, "utf-8");
  if (current.articleBodyHtml !== current.html) {
    writeFileSync(
      join(opts.outputDir, "final", "article-body.html"),
      current.articleBodyHtml,
      "utf-8",
    );
  }

  const finalFindings = finalIter?.findings ?? [];
  const finalScore = finalIter?.layerScores.overall ?? 0;
  const { verdict, reason } = deriveVerdict(finalFindings, finalScore);

  const paragraphMetrics = computeParagraphMetrics(current);

  const lastPrior = opts.priorRuns[opts.priorRuns.length - 1];
  const priorIssues = lastPrior
    ? diffAgainstPrior(priorFindingsFor(lastPrior), finalFindings)
    : [];
  const fixedPriorIssueCount = priorIssues.filter((p) => p.status === "fixed").length;
  const unresolvedPriorIssueCount = priorIssues.filter((p) => p.status === "still_present").length;
  const regressedPriorIssueCount = priorIssues.filter((p) => p.status === "regressed").length;

  const version = opts.versionOverride ?? opts.priorRuns.length + 1;
  const isFinal = version >= 3;
  const previousVersions = opts.priorRuns.map((r) => r.timestamp);

  const effectiveWeights: ScoreWeights = weights
    ? {
        technical: weights.technical,
        humanization: weights.humanization,
        quality: weights.quality,
      }
    : {
        technical: config.weights.technical,
        humanization: config.weights.humanization,
        quality: config.weights.quality,
      };

  return {
    slug: initialInput.slug,
    brand: initialInput.brand,
    postType: initialInput.postType,
    version,
    isFinal,
    previousVersions,
    priorIssues,
    fixedPriorIssueCount,
    unresolvedPriorIssueCount,
    regressedPriorIssueCount,
    paragraphMetrics,
    confirmedFindings: lastConfirmed,
    rejectedFindings: lastRejected,
    blogBusterVersion: BLOG_BUSTER_VERSION,
    scoreWeights: effectiveWeights,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    verdict,
    verdictReason: reason,
    stopReason,
    criticalCount: countCritical(finalFindings),
    iterations,
    finalHtmlPath,
    finalScore,
    totalCostUsd: totalCost,
  };
}
