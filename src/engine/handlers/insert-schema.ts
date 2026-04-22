import { parse } from "node-html-parser";
import type { Patch } from "../../types.js";

// Handles patches of type insert_schema. Two modes encoded in patch.target:
//
//   "add:<@type>"                -> insert new top-level entity of @type.
//                                   patch.after is the full entity JSON.
//                                   Appends into the first @graph or first
//                                   standalone entity array we find.
//
//   "<@type>.<field>"            -> set/overwrite <field> on the first entity
//                                   matching <@type>. patch.after is the
//                                   field value (JSON-encoded if object/array,
//                                   raw string if primitive).
//
// Patches without a parseable JSON-LD block in <head> are rejected rather
// than attempting to create a new <script type="application/ld+json"> block
// from scratch (too risky without the brand/author context).
export interface SchemaEditResult {
  html: string;
  ok: boolean;
  reason?: string;
}

type JsonLdNode = Record<string, unknown>;

function parseAfterValue(after: string): unknown {
  const trimmed = after.trim();
  if (!trimmed) return "";
  // If it parses as JSON, use the parsed value (object, array, number, bool).
  // Otherwise treat as a plain string.
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function findEntityByType(
  root: JsonLdNode | JsonLdNode[],
  targetType: string,
): JsonLdNode | null {
  if (Array.isArray(root)) {
    for (const node of root) {
      const hit = findEntityByType(node, targetType);
      if (hit) return hit;
    }
    return null;
  }
  if (!root || typeof root !== "object") return null;
  const t = root["@type"];
  if (t === targetType || (Array.isArray(t) && t.includes(targetType))) {
    return root;
  }
  // Traverse @graph if present
  const graph = root["@graph"];
  if (Array.isArray(graph)) {
    for (const node of graph as JsonLdNode[]) {
      const hit = findEntityByType(node, targetType);
      if (hit) return hit;
    }
  }
  return null;
}

function appendEntity(
  root: JsonLdNode | JsonLdNode[],
  newEntity: JsonLdNode,
): boolean {
  if (Array.isArray(root)) {
    root.push(newEntity);
    return true;
  }
  if (!root || typeof root !== "object") return false;
  const graph = root["@graph"];
  if (Array.isArray(graph)) {
    (graph as JsonLdNode[]).push(newEntity);
    return true;
  }
  return false;
}

export function applyInsertSchema(html: string, patch: Patch): SchemaEditResult {
  if (!patch.target) {
    return { html, ok: false, reason: "insert_schema: empty target" };
  }
  const root = parse(html);
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  if (!scripts.length) {
    return {
      html,
      ok: false,
      reason: "insert_schema: no <script type=application/ld+json> block to mutate",
    };
  }

  let mutated = false;
  let mutationError: string | null = null;

  for (const scriptNode of scripts) {
    const raw = scriptNode.text.trim();
    if (!raw) continue;
    let parsed: JsonLdNode | JsonLdNode[];
    try {
      parsed = JSON.parse(raw);
    } catch {
      mutationError = "insert_schema: JSON-LD block did not parse";
      continue;
    }

    if (patch.target.startsWith("add:")) {
      const newType = patch.target.slice(4).trim();
      const newEntity = parseAfterValue(patch.after) as JsonLdNode;
      if (!newEntity || typeof newEntity !== "object" || Array.isArray(newEntity)) {
        return {
          html,
          ok: false,
          reason: "insert_schema: `after` must be a JSON object for add: targets",
        };
      }
      if (!newEntity["@type"]) newEntity["@type"] = newType;
      const appended = appendEntity(parsed, newEntity);
      if (!appended) continue;
      scriptNode.set_content(JSON.stringify(parsed, null, 2));
      mutated = true;
      break;
    }

    const [typeName, ...fieldParts] = patch.target.split(".");
    const fieldPath = fieldParts.join(".");
    if (!typeName || !fieldPath) {
      return {
        html,
        ok: false,
        reason: `insert_schema: invalid target "${patch.target}" (expected "@type.field")`,
      };
    }
    const entity = findEntityByType(parsed, typeName);
    if (!entity) continue;
    const value = parseAfterValue(patch.after);
    // Simple one-level path for now. Nested paths (e.g. "BlogPosting.author.name")
    // get split by dots.
    const segments = fieldPath.split(".");
    let cursor: JsonLdNode = entity;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const next = cursor[seg];
      if (next && typeof next === "object" && !Array.isArray(next)) {
        cursor = next as JsonLdNode;
      } else {
        cursor[seg] = {};
        cursor = cursor[seg] as JsonLdNode;
      }
    }
    cursor[segments[segments.length - 1]] = value;
    scriptNode.set_content(JSON.stringify(parsed, null, 2));
    mutated = true;
    break;
  }

  if (!mutated) {
    return {
      html,
      ok: false,
      reason: mutationError ?? `insert_schema: could not locate target "${patch.target}" in any JSON-LD block`,
    };
  }

  return { html: root.toString(), ok: true };
}
