import { parse } from "node-html-parser";
import type { AuditInput, Finding } from "../../types.js";

// Presence + structural validity of JSON-LD blocks, independent of the
// per-type field specs handled in json-ld.ts. This fires on structural
// errors *before* field-level checks run so downstream detectors don't
// waste cycles on malformed blocks.

export function auditSchemaValidity(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const root = parse(input.html);
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');

  if (scripts.length === 0) {
    // D_no_schema_blocks is already emitted from json-ld.ts — don't duplicate.
    return findings;
  }

  let blockIndex = 0;
  for (const script of scripts) {
    blockIndex++;
    const raw = script.text.trim();
    if (!raw) {
      findings.push({
        checkId: "V_schema_empty_block",
        layer: "technical",
        severity: "fail",
        evidence: `JSON-LD block #${blockIndex} is empty — remove the script tag or populate`,
        sieveRules: [],
        sieveAps: [],
        truthBadge: "hard",
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      findings.push({
        checkId: "V_schema_invalid_json",
        layer: "technical",
        severity: "critical",
        evidence: `JSON-LD block #${blockIndex} failed to parse: ${
          (err as Error).message
        }. Downstream schema checks cannot run on this block.`,
        sieveRules: [],
        sieveAps: [],
        truthBadge: "hard",
      });
      continue;
    }

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        findings.push({
          checkId: "V_schema_empty_array_root",
          layer: "technical",
          severity: "warn",
          evidence: `JSON-LD block #${blockIndex}: root is an empty array`,
          sieveRules: [],
          sieveAps: [],
          truthBadge: "hard",
        });
      } else {
        for (const item of parsed) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            validateEntityNode(item as Record<string, unknown>, blockIndex, findings);
          } else {
            findings.push({
              checkId: "V_schema_invalid_root",
              layer: "technical",
              severity: "fail",
              evidence: `JSON-LD block #${blockIndex}: root array contains a non-object item`,
              sieveRules: [],
              sieveAps: [],
              truthBadge: "hard",
            });
          }
        }
      }
    } else if (parsed && typeof parsed === "object") {
      validateEntityNode(parsed as Record<string, unknown>, blockIndex, findings);
    } else {
      findings.push({
        checkId: "V_schema_invalid_root",
        layer: "technical",
        severity: "fail",
        evidence: `JSON-LD block #${blockIndex} root is not an object or array (got ${typeof parsed})`,
        sieveRules: [],
        sieveAps: [],
        truthBadge: "hard",
      });
    }
  }

  return findings;
}

function validateEntityNode(
  obj: Record<string, unknown>,
  blockIndex: number,
  findings: Finding[],
): void {

  // @context: warn if absent at root (nested @graph nodes don't need it)
  // Only complain at top level — we can't always know we're at top from here.

  // @graph handling
  if ("@graph" in obj) {
    const graph = obj["@graph"];
    if (!Array.isArray(graph)) {
      findings.push({
        checkId: "V_schema_graph_not_array",
        layer: "technical",
        severity: "fail",
        evidence: `JSON-LD block #${blockIndex}: @graph must be an array (got ${typeof graph})`,
        sieveRules: [],
        sieveAps: [],
        truthBadge: "hard",
      });
    } else {
      for (const item of graph) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          validateEntityNode(item as Record<string, unknown>, blockIndex, findings);
        } else {
          findings.push({
            checkId: "V_schema_graph_non_object_item",
            layer: "technical",
            severity: "fail",
            evidence: `JSON-LD block #${blockIndex}: @graph contains a non-object item`,
            sieveRules: [],
            sieveAps: [],
            truthBadge: "hard",
          });
        }
      }
    }
  }

  // @type — every entity node should have one (nodes with only @id as refs are fine)
  const hasId = "@id" in obj;
  const hasType = "@type" in obj;
  const hasGraph = "@graph" in obj;
  const hasContext = "@context" in obj;

  // A pure reference shape { "@id": "..." } is valid — skip type check.
  const isReferenceNode =
    hasId && !hasType && Object.keys(obj).length === 1;

  // An envelope shape { "@context": "...", "@graph": [...] } is valid — skip type check.
  const isEnvelope = hasGraph && !hasType;

  if (!hasType && !isReferenceNode && !isEnvelope && !hasGraph) {
    findings.push({
      checkId: "V_schema_entity_no_type",
      layer: "technical",
      severity: "warn",
      evidence: `JSON-LD block #${blockIndex}: entity has no @type (keys: ${Object.keys(obj).slice(0, 5).join(", ")})`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
  }

  if (hasType) {
    const t = obj["@type"];
    const typeValid =
      (typeof t === "string" && t.length > 0) ||
      (Array.isArray(t) &&
        t.length > 0 &&
        t.every((x) => typeof x === "string" && x.length > 0));
    if (!typeValid) {
      findings.push({
        checkId: "V_schema_invalid_type_value",
        layer: "technical",
        severity: "fail",
        evidence: `JSON-LD block #${blockIndex}: @type must be a non-empty string or array of non-empty strings (got ${JSON.stringify(
          t,
        )})`,
        sieveRules: [],
        sieveAps: [],
        truthBadge: "hard",
      });
    }
  }

  // Recurse into nested object values (but only objects, never primitives).
  if (!isReferenceNode) {
    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith("@")) continue; // already handled above
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            validateEntityNode(item as Record<string, unknown>, blockIndex, findings);
          }
        }
      } else if (val && typeof val === "object") {
        validateEntityNode(val as Record<string, unknown>, blockIndex, findings);
      }
    }
  }

  // Context-level hint: top-level entities should have @context (or be in a graph envelope)
  if (!hasContext && !hasGraph) {
    // Only fire once per block at the root — avoid noise on nested entities.
    // We don't track "is this the root" here, so skip; V_schema_invalid_root covers the worst cases.
  }
}
