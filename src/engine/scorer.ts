import type { Finding, LayerScores, Verdict } from "../types.js";
import { config } from "../config.js";

const SEVERITY_PENALTY = {
  critical: 30,
  fail: 14,
  warn: 5,
  info: 1,
} as const;

export function scoreLayer(findings: Finding[], layers: string[]): number {
  let score = 100;
  for (const f of findings) {
    if (!layers.includes(f.layer)) continue;
    score -= SEVERITY_PENALTY[f.severity];
  }
  return Math.max(0, score);
}

export function scoreTechnical(findings: Finding[]): number {
  return scoreLayer(findings, ["technical", "eeat"]);
}

export function composeScores(
  technical: number,
  humanization: number,
  quality: number,
): LayerScores {
  const w = config.weights;
  const overall = Math.round(
    technical * w.technical + humanization * w.humanization + quality * w.quality,
  );
  return { technical, humanization, quality, overall };
}

export function countCritical(findings: Finding[]): number {
  return findings.filter((f) => f.severity === "critical").length;
}

export function deriveVerdict(
  findings: Finding[],
  overall: number,
): { verdict: Verdict; reason: string } {
  const criticals = findings.filter((f) => f.severity === "critical");
  if (criticals.length > 0) {
    const ids = criticals
      .slice(0, 3)
      .map((c) => c.checkId)
      .join(", ");
    return {
      verdict: "block",
      reason: `${criticals.length} critical finding(s) — cannot ship: ${ids}${criticals.length > 3 ? "..." : ""}`,
    };
  }
  if (overall >= config.targetScore) {
    return { verdict: "ship", reason: `Overall ${overall} ≥ target ${config.targetScore}` };
  }
  return {
    verdict: "edit",
    reason: `Overall ${overall} < target ${config.targetScore}; no criticals but needs editing`,
  };
}
