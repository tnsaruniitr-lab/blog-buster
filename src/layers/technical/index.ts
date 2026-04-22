import type { AuditInput, Finding } from "../../types.js";
import { auditHtmlStructure } from "./html-structure.js";
import { auditJsonLd } from "./json-ld.js";
import { auditMetaTags } from "./meta-tags.js";
import { auditSchemaVisibleParity } from "./schema-visible-parity.js";
import { runAdvancedStructure } from "./advanced-structure.js";

export function runTechnicalLayer(input: AuditInput): Finding[] {
  return [
    ...auditHtmlStructure(input),
    ...auditJsonLd(input),
    ...auditMetaTags(input),
    ...auditSchemaVisibleParity(input),
    ...runAdvancedStructure(input),
  ];
}
