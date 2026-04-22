import type { AuditInput, Finding } from "../../types.js";
import { schemaSpecs, brainFor } from "../../shared-lib/registry.js";
import {
  extractSchemaBlocks,
  flattenEntities,
  entityTypes,
} from "../../shared-lib/validators.js";

const ISO_WITH_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function validateCustom(
  entity: Record<string, unknown>,
  checks: string[],
  findings: Finding[],
) {
  const type = entityTypes(entity)[0] ?? "unknown";

  if (checks.includes("faqpage_mainentity_is_array_of_questions")) {
    const me = entity.mainEntity;
    if (!Array.isArray(me)) {
      findings.push({
        checkId: "D_faq_mainentity_not_array",
        layer: "technical",
        severity: "fail",
        evidence: "FAQPage.mainEntity is not an array of Question entities",
        sieveRules: [],
        sieveAps: [],
        truthBadge: "hard",
      });
    } else {
      const bad = me.find((q) => {
        const qObj = q as Record<string, unknown>;
        const hasQ = qObj["@type"] === "Question" && typeof qObj.name === "string";
        const ans = qObj.acceptedAnswer as Record<string, unknown> | undefined;
        const hasA = ans && typeof ans.text === "string";
        return !hasQ || !hasA;
      });
      if (bad) {
        findings.push({
          checkId: "D_faq_mainentity_malformed",
          layer: "technical",
          severity: "fail",
          evidence: "FAQPage Question entry missing name or acceptedAnswer.text",
          sieveRules: [],
          sieveAps: [],
          truthBadge: "hard",
        });
      }
    }
  }

  if (checks.includes("breadcrumblist_sequential_positions_from_one")) {
    const items = entity.itemListElement as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(items)) {
      const positions = items.map((i) => Number(i.position)).filter((n) => !Number.isNaN(n));
      const sequential = positions.every((p, i) => p === i + 1);
      if (!sequential) {
        findings.push({
          checkId: "D_breadcrumb_positions_invalid",
          layer: "technical",
          severity: "fail",
          evidence: `BreadcrumbList positions not sequential 1..n: [${positions.join(", ")}]`,
          sieveRules: [],
          sieveAps: [],
          truthBadge: "hard",
        });
      }
    }
  }

  if (checks.includes("datemodified_iso_8601_with_time")) {
    const dm = entity.dateModified;
    if (typeof dm === "string" && !ISO_WITH_TIME.test(dm)) {
      findings.push({
        checkId: "D_datemodified_missing_time",
        layer: "technical",
        severity: "warn",
        evidence: `dateModified "${dm}" should include time (ISO 8601 with T)`,
        sieveRules: [],
        sieveAps: [],
        truthBadge: "hard",
      });
    }
  }

  if (checks.includes("datemodified_not_current_timestamp")) {
    const dm = entity.dateModified;
    if (typeof dm === "string") {
      const parsed = Date.parse(dm);
      if (!Number.isNaN(parsed) && Math.abs(Date.now() - parsed) < 60_000) {
        findings.push({
          checkId: "D_datemodified_is_now",
          layer: "technical",
          severity: "warn",
          evidence: `dateModified equals Date.now() — suspicious auto-stamp`,
          sieveRules: [],
          sieveAps: [],
          truthBadge: "heuristic",
        });
      }
    }
  }

  if (checks.includes("every_entity_has_stable_id")) {
    if (!entity["@id"]) {
      findings.push({
        checkId: "D_entity_missing_id",
        layer: "technical",
        severity: "info",
        evidence: `${type} entity has no @id for cross-page entity graph`,
        sieveRules: [],
        sieveAps: [],
        truthBadge: "static",
      });
    }
  }
}

export function auditJsonLd(input: AuditInput): Finding[] {
  const findings: Finding[] = [];

  const blocks = input.schemas.length ? input.schemas : extractSchemaBlocks(input.html);
  if (!blocks.length) {
    findings.push({
      checkId: "D_no_schema_blocks",
      layer: "technical",
      severity: "critical",
      evidence: "No JSON-LD schema blocks found in page",
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
    return findings;
  }

  const entities = flattenEntities(blocks);
  if (!entities.find((e) => entityTypes(e).some((t) => ["BlogPosting", "Article", "NewsArticle"].includes(t)))) {
    findings.push({
      checkId: "D_no_article_entity",
      layer: "technical",
      severity: "critical",
      evidence: "No BlogPosting/Article/NewsArticle entity present",
      sieveRules: brainFor("D6_required_fields").rules,
      sieveAps: brainFor("D6_required_fields").aps,
      truthBadge: "hard",
    });
  }

  for (const entity of entities) {
    for (const type of entityTypes(entity)) {
      const spec = schemaSpecs.field_specs[type];
      if (!spec) continue;

      const missingRequired = spec.required.filter((f) => entity[f] === undefined);
      if (missingRequired.length) {
        findings.push({
          checkId: `D_${type}_missing_required`,
          layer: "technical",
          severity: "fail",
          evidence: `${type} missing required: ${missingRequired.join(", ")}`,
          sieveRules: brainFor("D6_required_fields").rules,
          sieveAps: brainFor("D6_required_fields").aps,
          truthBadge: "hard",
        });
      }

      const missingGoogle = spec.google_required.filter((f) => entity[f] === undefined);
      if (missingGoogle.length) {
        findings.push({
          checkId: `D_${type}_missing_google_required`,
          layer: "technical",
          severity: "fail",
          evidence: `${type} missing Google-required: ${missingGoogle.join(", ")}`,
          sieveRules: brainFor("D6_required_fields").rules,
          sieveAps: brainFor("D6_required_fields").aps,
          truthBadge: "hard",
        });
      }

      const missingRec = spec.recommended.filter((f) => entity[f] === undefined);
      if (missingRec.length) {
        findings.push({
          checkId: `D_${type}_missing_recommended`,
          layer: "technical",
          severity: "warn",
          evidence: `${type} missing recommended: ${missingRec.join(", ")}`,
          sieveRules: [],
          sieveAps: [],
          truthBadge: "static",
        });
      }

      if (spec.custom_checks?.length) {
        validateCustom(entity, spec.custom_checks, findings);
      }
    }
  }

  return findings;
}
