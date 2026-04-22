import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { callClaude } from "../anthropic-client.js";
import { config } from "../config.js";
import type { Finding, Patch } from "../types.js";

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

export async function planPatches(findings: Finding[]): Promise<{
  patches: PlannedPatch[];
  cost: number;
}> {
  const patches: PlannedPatch[] = [];
  let cost = 0;

  const dedupedSpans = new Set<string>();

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
    }
  }

  return { patches, cost };
}
