import type {
  Finding,
  PreflightFinding,
  RejectedPreflightFinding,
  Severity,
} from "../types.js";

// Mapping: shakespeer namespaced check_id -> equivalent blog-buster check_id.
// Only populated for genuinely overlapping checks. Unique-on-one-side checks
// are not listed and simply pass through without confirm/reject adjudication.
//
// This table is the single source of truth for the two-witness signal in
// handshake §5.2. Keep it minimal and evidence-driven — every entry should
// be justified by code inspection on both sides.
const SHAKESPEER_TO_BLOG_BUSTER: Record<string, string[]> = {
  // B2 question-form H2 ratio ↔ S_h2_question_ratio_low (both at 40% threshold)
  "shakespeer:B2": ["S_h2_question_ratio_low"],
  // F7 visible Last Reviewed + Next Review ↔ S_visible_last_updated_missing (after regex extension)
  "shakespeer:F7": ["S_visible_last_updated_missing"],
  // F2 first-party data language markers ↔ E_no_first_party_data (blog-buster is narrower)
  "shakespeer:F2": ["E_no_first_party_data"],
};

export interface ReconciliationResult {
  preflightAsFindings: Finding[];
  confirmed: string[];
  rejected: RejectedPreflightFinding[];
}

export function reconcilePreflight(
  preflight: PreflightFinding[],
  detectedFindings: Finding[],
): ReconciliationResult {
  if (!preflight.length) {
    return { preflightAsFindings: [], confirmed: [], rejected: [] };
  }

  const detectedByCheckId = new Set(detectedFindings.map((f) => f.checkId));
  const confirmed: string[] = [];
  const rejected: RejectedPreflightFinding[] = [];
  const preflightAsFindings: Finding[] = [];

  for (const pf of preflight) {
    preflightAsFindings.push({
      checkId: pf.check_id,
      layer: "preflight",
      severity: pf.severity as Severity,
      evidence: pf.evidence,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "static",
    });

    const mappedBlogBusterIds = SHAKESPEER_TO_BLOG_BUSTER[pf.check_id];
    if (!mappedBlogBusterIds || mappedBlogBusterIds.length === 0) {
      // No mapping — unique to shakespeer, pass through without adjudication
      continue;
    }

    const blogBusterAlsoFlagged = mappedBlogBusterIds.some((id) =>
      detectedByCheckId.has(id),
    );
    if (blogBusterAlsoFlagged) {
      confirmed.push(pf.check_id);
    } else {
      rejected.push({
        check_id: pf.check_id,
        reason: `blog-buster equivalents [${mappedBlogBusterIds.join(", ")}] did not flag; detector scope or thresholds differ`,
      });
    }
  }

  return { preflightAsFindings, confirmed, rejected };
}
