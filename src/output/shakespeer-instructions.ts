import type { AuditReport, Finding, Patch, PriorIssueStatus, Severity } from "../types.js";
import {
  planEmDashPatches,
  planTricolonRewrites,
  planPassiveRewrites,
  makeFragmentUnique,
} from "../engine/planners/style-planners.js";

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

const STYLE_FAN_OUT_CHECKS = new Set([
  "H_em_dash_overuse",
  "H_tricolon_density",
  "H_passive_overuse",
]);

function patchToEnvelope(p: Patch): ShakespeerPatchEnvelope {
  return {
    type: p.type,
    target: p.target,
    before: p.before,
    after: p.after,
    rationale: p.rationale,
  };
}

function singleInstructionFromFinding(f: Finding): ShakespeerInstruction {
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

  return {
    check_id: f.checkId,
    severity: f.severity,
    layer: f.layer,
    evidence: f.evidence,
    action,
    ...(f.suggestedPatch ? { patch: patchToEnvelope(f.suggestedPatch) } : {}),
  };
}

// Kept for backward compatibility with callers that expected a 1:1 mapping.
// New code should use findingToInstructions (plural).
export function findingToInstruction(f: Finding): ShakespeerInstruction {
  return singleInstructionFromFinding(f);
}

/**
 * Fans a single Finding out into one or more ShakespeerInstructions.
 *
 *   • Default: [one instruction] derived from the finding's suggestedPatch
 *     or checkId-prefix action routing.
 *   • Style checks (em-dash / tricolon / passive): N paragraph-scoped
 *     instructions, one per offending paragraph. Each has a unique `before`
 *     string so shakes-peer's duplicate-match guard passes.
 *   • LLM-judge findings with non-unique `before`: extended with surrounding
 *     context until unique (or skipped if extension exhausted).
 */
export function findingToInstructions(
  f: Finding,
  html: string | null,
): ShakespeerInstruction[] {
  if (html && STYLE_FAN_OUT_CHECKS.has(f.checkId)) {
    const patches =
      f.checkId === "H_em_dash_overuse"
        ? planEmDashPatches(html)
        : f.checkId === "H_tricolon_density"
          ? planTricolonRewrites(html)
          : planPassiveRewrites(html);

    if (patches.length === 0) {
      // Fall back to single generic instruction — shakes-peer may still
      // pick up a synthesizer by checkId. Better than emitting nothing.
      return [singleInstructionFromFinding(f)];
    }

    return patches.map((p, i) => ({
      check_id: f.checkId,
      severity: f.severity,
      layer: f.layer,
      evidence: `${f.evidence} — targeted paragraph ${i + 1}/${patches.length}`,
      action:
        p.type === "rewrite_paragraph" || p.type === "rewrite_intro"
          ? "attempt_rewrite"
          : "apply_patch",
      patch: patchToEnvelope(p),
    }));
  }

  // Disambiguate LLM-judge patches whose `before` may hit multiple spans.
  if (html && f.suggestedPatch && f.suggestedPatch.before) {
    const unique = makeFragmentUnique(f.suggestedPatch.before, html);
    if (unique && unique.before !== f.suggestedPatch.before) {
      // Extend both sides: before gets extended context; after must preserve
      // the same context so the swap doesn't delete surrounding characters.
      const extendedAfter = unique.prefix + f.suggestedPatch.after + unique.suffix;
      return [
        {
          check_id: f.checkId,
          severity: f.severity,
          layer: f.layer,
          evidence: f.evidence,
          action: "apply_patch",
          patch: {
            type: f.suggestedPatch.type,
            target: f.suggestedPatch.target,
            before: unique.before,
            after: extendedAfter,
            rationale:
              f.suggestedPatch.rationale +
              " (before extended with context for unique match)",
          },
        },
      ];
    }
  }

  return [singleInstructionFromFinding(f)];
}

export function buildShakespeerInstructions(
  report: AuditReport,
  targetScore: number,
  finalHtml: string | null = null,
): ShakespeerInstructionsPayload {
  const finalIter = report.iterations[report.iterations.length - 1];
  const findings = finalIter?.findings ?? [];
  const instructions = findings
    .flatMap((f) => findingToInstructions(f, finalHtml))
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
