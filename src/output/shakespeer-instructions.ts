import type { AuditReport, Finding, PriorIssueStatus, Severity } from "../types.js";

export interface ShakespeerPatchEnvelope {
  type: string;
  target: string;
  before: string;
  after: string;
  rationale: string;
}

export interface ShakespeerInstruction {
  check_id: string;
  severity: Severity;
  layer: string;
  evidence: string;
  action:
    | "apply_patch"
    | "human_fix_required"
    | "attempt_rewrite"
    | "insert_missing"
    | "edit_schema";
  patch?: ShakespeerPatchEnvelope;
}

export interface ShakespeerInstructionsPayload {
  meta: {
    version: number;
    next_version: number;
    is_final_pending: boolean;
    is_final: boolean;
    brand: string;
    slug: string;
    post_type: string;
    verdict: "ship" | "edit" | "block";
    final_score: number;
    critical_count: number;
    target_score: number;
  };
  fix_order: string[];
  instructions: ShakespeerInstruction[];
  regressions: PriorIssueStatus[];
}

const PRIORITY: Record<Severity, number> = {
  critical: 0,
  fail: 1,
  warn: 2,
  info: 3,
};

export function findingToInstruction(f: Finding): ShakespeerInstruction {
  let action: ShakespeerInstruction["action"];
  if (f.suggestedPatch) {
    action = "apply_patch";
  } else if (f.severity === "critical") {
    action = "human_fix_required";
  } else if (f.checkId.startsWith("D_") || f.checkId.startsWith("S_missing_")) {
    action = "insert_missing";
  } else if (f.checkId.startsWith("M_")) {
    action = "edit_schema";
  } else {
    action = "attempt_rewrite";
  }

  const envelope: ShakespeerPatchEnvelope | undefined = f.suggestedPatch
    ? {
        type: f.suggestedPatch.type,
        target: f.suggestedPatch.target,
        before: f.suggestedPatch.before,
        after: f.suggestedPatch.after,
        rationale: f.suggestedPatch.rationale,
      }
    : undefined;

  return {
    check_id: f.checkId,
    severity: f.severity,
    layer: f.layer,
    evidence: f.evidence,
    action,
    ...(envelope ? { patch: envelope } : {}),
  };
}

export function buildShakespeerInstructions(
  report: AuditReport,
  targetScore: number,
): ShakespeerInstructionsPayload {
  const finalIter = report.iterations[report.iterations.length - 1];
  const findings = finalIter?.findings ?? [];
  const instructions = findings
    .map(findingToInstruction)
    .sort((a, b) => PRIORITY[a.severity] - PRIORITY[b.severity]);

  return {
    meta: {
      version: report.version,
      next_version: report.version + 1,
      is_final_pending: report.version === 2,
      is_final: report.isFinal,
      brand: report.brand,
      slug: report.slug,
      post_type: report.postType,
      verdict: report.verdict,
      final_score: report.finalScore,
      critical_count: report.criticalCount,
      target_score: targetScore,
    },
    fix_order: instructions.map((i) => i.check_id),
    instructions,
    regressions: report.priorIssues.filter((p) => p.status === "regressed"),
  };
}
