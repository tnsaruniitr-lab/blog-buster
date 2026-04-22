import type { AuditInput, Finding } from "../../types.js";
import { computeHumanizationSignals } from "./signals.js";
import { runHumanizationJudge } from "./llm-judge.js";

export interface HumanizationResult {
  findings: Finding[];
  score: number;
  cost: number;
  signalScore: number;
  judgeScore: number;
  metrics: Record<string, number>;
}

export async function runHumanizationLayer(
  input: AuditInput,
  opts: { runJudge: boolean },
): Promise<HumanizationResult> {
  const sig = computeHumanizationSignals(input);
  if (!opts.runJudge) {
    return {
      findings: sig.findings,
      score: sig.score,
      cost: 0,
      signalScore: sig.score,
      judgeScore: 0,
      metrics: sig.metrics,
    };
  }

  const judge = await runHumanizationJudge(input);
  const findings = [...sig.findings, ...judge.findings];
  const blended = Math.round(sig.score * 0.45 + judge.score * 0.55);
  return {
    findings,
    score: blended,
    cost: judge.cost,
    signalScore: sig.score,
    judgeScore: judge.score,
    metrics: sig.metrics,
  };
}
