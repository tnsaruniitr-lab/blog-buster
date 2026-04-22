import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { SchemaSpecs, BrainMappings } from "../types.js";

const here = dirname(fileURLToPath(import.meta.url));

export const schemaSpecs: SchemaSpecs = JSON.parse(
  readFileSync(join(here, "schema-specs.json"), "utf-8"),
);

export const brainMappings: BrainMappings = JSON.parse(
  readFileSync(join(here, "brain-mappings.json"), "utf-8"),
);

export function brainFor(checkId: string): { rules: number[]; aps: number[] } {
  const m = brainMappings.mappings[checkId];
  return {
    rules: m?.rules ?? [],
    aps: m?.anti_patterns ?? [],
  };
}
