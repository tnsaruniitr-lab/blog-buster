import type { AuditInput, Finding } from "../../types.js";
import {
  extractSchemaBlocks,
  flattenEntities,
  entityTypes,
  faqVisibleCount,
} from "../../shared-lib/validators.js";

export function auditSchemaVisibleParity(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const blocks = input.schemas.length ? input.schemas : extractSchemaBlocks(input.html);
  const entities = flattenEntities(blocks);

  const faqEntity = entities.find((e) => entityTypes(e).includes("FAQPage"));
  if (faqEntity) {
    const me = faqEntity.mainEntity;
    const schemaQuestions = Array.isArray(me) ? me.length : 0;
    const visibleQuestions = faqVisibleCount(input.html);
    if (schemaQuestions > 0 && Math.abs(schemaQuestions - visibleQuestions) > 1) {
      findings.push({
        checkId: "P_faq_count_mismatch",
        layer: "technical",
        severity: "fail",
        evidence: `FAQPage schema has ${schemaQuestions} Questions but page shows ~${visibleQuestions} FAQ pairs`,
        sieveRules: [],
        sieveAps: [],
        truthBadge: "measured",
      });
    }
  }

  return findings;
}
