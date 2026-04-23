import type { AuditInput, Finding } from "../../types.js";
import {
  extractSchemaBlocks,
  flattenEntities,
  entityTypes,
} from "../../shared-lib/validators.js";

// Per writer-shape-spec §1.1: every cross-reference between entities in
// the @graph must use `{"@id": "..."}` form pointing at an entity that
// actually exists in the graph. This detector:
//
//   1. Walks the graph, collects all declared @ids
//   2. Walks every field of every entity, finds reference shapes
//      ({"@id": "..."} objects), checks each ref resolves to a declared @id
//   3. Flags:
//        D_entity_id_unresolved      — ref points at @id not in the graph
//        D_entity_missing_id         — entity of significant @type has no @id
//        D_entity_inline_over_ref    — heuristic: author/publisher/etc. is
//                                       a full inline entity rather than a
//                                       {"@id": ref}. Softer finding.

// Entity types that should always have @id for cross-page reuse
const ID_REQUIRED_TYPES = new Set([
  "Person",
  "Organization",
  "WebPage",
  "WebSite",
  "BlogPosting",
  "Article",
  "NewsArticle",
  "BreadcrumbList",
  "FAQPage",
  "ImageObject",
]);

// Fields that SHOULD use reference form rather than inline when the target
// entity is likely to be reused across pages (author, publisher, etc.).
const REFERENCE_PREFERRED_FIELDS = new Set([
  "author",
  "publisher",
  "mainEntityOfPage",
  "isPartOf",
  "worksFor",
  "affiliation",
  "reviewedBy",
  "creator",
]);

export function auditEntityInterconnection(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const blocks = input.schemas.length ? input.schemas : extractSchemaBlocks(input.html);
  if (!blocks.length) return findings;

  const entities = flattenEntities(blocks);
  if (!entities.length) return findings;

  const declaredIds = new Set<string>();
  for (const e of entities) {
    const id = e["@id"];
    if (typeof id === "string" && id.length > 0) declaredIds.add(id);
  }

  // Check: every entity of a significant @type has an @id.
  for (const e of entities) {
    const types = entityTypes(e);
    const matchingTypes = types.filter((t) => ID_REQUIRED_TYPES.has(t));
    if (matchingTypes.length === 0) continue;
    if (!e["@id"]) {
      findings.push({
        checkId: "D_entity_missing_id",
        layer: "technical",
        severity: "warn",
        evidence: `Entity of type ${matchingTypes.join("/")} has no @id — cross-page interconnection blocked`,
        sieveRules: [],
        sieveAps: [],
        truthBadge: "hard",
      });
    }
  }

  // Check: every {"@id": ref} reference resolves to a declared @id.
  // Check: fields that should prefer reference form aren't inlined.
  for (const e of entities) {
    const ownType = entityTypes(e)[0] ?? "unknown";
    for (const [field, value] of Object.entries(e)) {
      if (field.startsWith("@")) continue;
      checkFieldRefs(field, value, ownType, declaredIds, findings);
    }
  }

  return findings;
}

function checkFieldRefs(
  field: string,
  value: unknown,
  ownType: string,
  declaredIds: Set<string>,
  findings: Finding[],
): void {
  if (!value) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      checkFieldRefs(field, item, ownType, declaredIds, findings);
    }
    return;
  }

  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;

  // Pure reference shape: { "@id": "https://..." } (no other keys or just @type)
  const keys = Object.keys(obj).filter((k) => k !== "@type");
  const isReferenceShape = keys.length === 1 && keys[0] === "@id";

  if (isReferenceShape) {
    const refId = obj["@id"];
    if (typeof refId === "string" && refId.length > 0) {
      if (!declaredIds.has(refId)) {
        findings.push({
          checkId: "D_entity_id_unresolved",
          layer: "technical",
          severity: "fail",
          evidence: `${ownType}.${field} references @id "${refId}" which is not declared in the graph`,
          sieveRules: [],
          sieveAps: [],
          truthBadge: "hard",
        });
      }
    }
    return;
  }

  // Inline-entity detection for reference-preferred fields.
  if (REFERENCE_PREFERRED_FIELDS.has(field) && "@type" in obj) {
    const inlineType = (obj as Record<string, unknown>)["@type"];
    const typeLabel = Array.isArray(inlineType) ? inlineType.join("/") : String(inlineType);
    findings.push({
      checkId: "D_entity_inline_over_ref",
      layer: "technical",
      severity: "info",
      evidence: `${ownType}.${field} is inlined as full ${typeLabel} entity — prefer {"@id": "..."} referencing a graph entry for reusability`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "heuristic",
    });
  }

  // Recurse into nested objects for @id refs deeper in the tree.
  for (const [subField, subVal] of Object.entries(obj)) {
    if (subField.startsWith("@")) continue;
    checkFieldRefs(subField, subVal, ownType, declaredIds, findings);
  }
}
