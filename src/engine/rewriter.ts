import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { callClaude } from "../anthropic-client.js";
import { config } from "../config.js";
import type { AuditInput, Finding, Patch } from "../types.js";
import { planMetaPatches } from "./planners/meta-planners.js";
import { planSchemaPatches } from "./planners/schema-planners.js";

const here = dirname(fileURLToPath(import.meta.url));
const SENTENCE_PROMPT = readFileSync(
  join(here, "../../prompts/sentence-rewrite.md"),
  "utf-8",
);

export async function llmRewriteSentence(sentence: string): Promise<{ text: string; cost: number }> {
  const r = await callClaude({
    model: config.modelRewrite,
    system: SENTENCE_PROMPT,
    user: `Rewrite this sentence:\n\n${sentence}`,
    maxTokens: 300,
    cacheSystem: true,
  });
  return { text: r.text.trim().replace(/^["']|["']$/g, ""), cost: r.costUsd };
}

export interface PlannedPatch {
  patch: Patch;
  sourceFinding: Finding;
}

const META_CHECKIDS = new Set([
  "M_title_missing",
  "M_title_length",
  "M_description_missing",
  "M_description_length",
  "M_og_incomplete",
]);

const SCHEMA_CHECKIDS = new Set([
  "D_no_article_entity",
  "D_WebPage_missing_required",
  "D_WebPage_missing_recommended",
  "D_Organization_missing_recommended",
  "D_BlogPosting_missing_google_required",
  "D_Article_missing_google_required",
  "D_NewsArticle_missing_google_required",
  "D_BlogPosting_missing_recommended",
  "D_Article_missing_recommended",
  "D_NewsArticle_missing_recommended",
]);

export async function planPatches(
  findings: Finding[],
  input?: AuditInput,
): Promise<{
  patches: PlannedPatch[];
  cost: number;
}> {
  const patches: PlannedPatch[] = [];
  let cost = 0;

  const dedupedSpans = new Set<string>();
  const metaFindings: Finding[] = [];
  const schemaFindings: Finding[] = [];

  for (const f of findings) {
    if (f.suggestedPatch) {
      if (f.suggestedPatch.type === "replace_span" || f.suggestedPatch.type === "rewrite_intro") {
        if (dedupedSpans.has(f.suggestedPatch.target)) continue;
        dedupedSpans.add(f.suggestedPatch.target);
      }
      patches.push({ patch: f.suggestedPatch, sourceFinding: f });
      continue;
    }

    if (f.checkId === "H_banned_vocabulary") {
      const words = f.evidence
        .match(/([a-z']+)\(\d+\)/g)
        ?.map((m) => m.split("(")[0]) ?? [];
      for (const w of words) {
        patches.push({
          patch: {
            type: "regex_replace",
            target: `\\b${w}\\b`,
            before: w,
            after: "",
            rationale: `Remove AI-signature word "${w}" via targeted resentence`,
          },
          sourceFinding: f,
        });
      }
      continue;
    }

    if (META_CHECKIDS.has(f.checkId)) {
      metaFindings.push(f);
      continue;
    }
    if (SCHEMA_CHECKIDS.has(f.checkId)) {
      schemaFindings.push(f);
      continue;
    }
  }

  if (input && metaFindings.length) {
    const metaPlan = await planMetaPatches(input, metaFindings);
    cost += metaPlan.cost;
    for (const p of metaPlan.patches) {
      patches.push({ patch: p, sourceFinding: metaFindings[0] });
    }
  }

  if (input && schemaFindings.length) {
    const schemaPlan = planSchemaPatches(input, schemaFindings);
    for (const p of schemaPlan.patches) {
      const source =
        schemaFindings.find((sf) => p.rationale.includes(sf.checkId)) ?? schemaFindings[0];
      patches.push({ patch: p, sourceFinding: source });
    }
  }

  return { patches, cost };
}
