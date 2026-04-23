import type { AuditInput, Finding } from "../../types.js";
import { auditHtmlStructure } from "./html-structure.js";
import { auditJsonLd } from "./json-ld.js";
import { auditMetaTags } from "./meta-tags.js";
import { auditSchemaVisibleParity } from "./schema-visible-parity.js";
import { runAdvancedStructure } from "./advanced-structure.js";
import { auditSchemaValidity } from "./schema-validity.js";
import { auditEntityInterconnection } from "./entity-interconnection.js";
import { auditCanonicalConsistency } from "./canonical-consistency.js";

export function runTechnicalLayer(input: AuditInput): Finding[] {
  return [
    ...auditHtmlStructure(input),
    ...auditSchemaValidity(input),
    ...auditJsonLd(input),
    ...auditEntityInterconnection(input),
    ...auditMetaTags(input),
    ...auditCanonicalConsistency(input),
    ...auditSchemaVisibleParity(input),
    ...runAdvancedStructure(input),
  ];
}
