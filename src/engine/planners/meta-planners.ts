import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "node-html-parser";
import { callClaude } from "../../anthropic-client.js";
import { config } from "../../config.js";
import { visibleText } from "../../shared-lib/validators.js";
import type { AuditInput, Finding, Patch } from "../../types.js";

const here = dirname(fileURLToPath(import.meta.url));
const META_PROMPT = readFileSync(
  join(here, "../../../prompts/meta-regenerate.md"),
  "utf-8",
);

interface CurrentMeta {
  title: string | null;
  description: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogType: string | null;
  ogUrl: string | null;
}

function readCurrentMeta(input: AuditInput): CurrentMeta {
  const root = parse(input.html);
  const title = root.querySelector("title")?.text.trim() ?? null;
  const metas = root.querySelectorAll("meta");
  let description: string | null = null;
  let ogTitle: string | null = null;
  let ogDescription: string | null = null;
  let ogType: string | null = null;
  let ogUrl: string | null = null;
  for (const m of metas) {
    const name = m.getAttribute("name");
    const prop = m.getAttribute("property");
    const content = m.getAttribute("content");
    if (!content) continue;
    if (name === "description") description = content.trim();
    else if (prop === "og:title") ogTitle = content.trim();
    else if (prop === "og:description") ogDescription = content.trim();
    else if (prop === "og:type") ogType = content.trim();
    else if (prop === "og:url") ogUrl = content.trim();
  }
  return { title, description, ogTitle, ogDescription, ogType, ogUrl };
}

function truncateForSnippet(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

async function llmGenerateMeta(
  input: AuditInput,
): Promise<{ title: string; description: string; cost: number } | null> {
  const bodyPreview = truncateForSnippet(
    visibleText(input.articleBodyHtml || input.html),
    1500,
  );
  const user = `Topic: ${input.topic ?? "unknown"}
Primary keyword: ${input.primaryKeyword ?? "unknown"}
Secondary keywords: ${(input.secondaryKeywords ?? []).join(", ") || "(none)"}
Body (first 1500 chars):
---
${bodyPreview}
---`;

  try {
    const r = await callClaude({
      model: config.modelRewrite,
      system: META_PROMPT,
      user,
      maxTokens: 500,
      cacheSystem: true,
    });
    const m = r.text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { title?: string; description?: string };
    if (!parsed.title || !parsed.description) return null;
    return { title: parsed.title, description: parsed.description, cost: r.costUsd };
  } catch {
    return null;
  }
}

export interface MetaPlanOutput {
  patches: Patch[];
  cost: number;
}

export async function planMetaPatches(
  input: AuditInput,
  metaFindings: Finding[],
): Promise<MetaPlanOutput> {
  if (!metaFindings.length) return { patches: [], cost: 0 };

  const current = readCurrentMeta(input);
  const patches: Patch[] = [];
  let cost = 0;

  const needsTitleRegen = metaFindings.some(
    (f) => f.checkId === "M_title_missing" || f.checkId === "M_title_length",
  );
  const needsDescRegen = metaFindings.some(
    (f) =>
      f.checkId === "M_description_missing" ||
      f.checkId === "M_description_length",
  );
  const hasOgIncomplete = metaFindings.some((f) => f.checkId === "M_og_incomplete");

  let newTitle: string | null = null;
  let newDescription: string | null = null;

  if (needsTitleRegen || needsDescRegen) {
    const regen = await llmGenerateMeta(input);
    if (regen) {
      cost += regen.cost;
      if (needsTitleRegen) newTitle = regen.title;
      if (needsDescRegen) newDescription = regen.description;
    }
  }

  if (newTitle) {
    patches.push({
      type: "meta_tag_edit",
      target: "title",
      before: current.title ?? "",
      after: newTitle,
      rationale: "Regenerate <title> to 50–60 chars with primary keyword",
    });
  }
  if (newDescription) {
    patches.push({
      type: "meta_tag_edit",
      target: "description",
      before: current.description ?? "",
      after: newDescription,
      rationale: "Regenerate meta description to 120–160 chars with primary keyword",
    });
  }

  // OG completeness: deterministic clone from whatever we have (or the
  // freshly-regenerated values above).
  if (hasOgIncomplete) {
    const effectiveTitle = newTitle ?? current.title ?? current.ogTitle;
    const effectiveDescription =
      newDescription ?? current.description ?? current.ogDescription;
    if (effectiveTitle && !current.ogTitle) {
      patches.push({
        type: "meta_tag_edit",
        target: "og:title",
        before: "",
        after: effectiveTitle,
        rationale: "Add og:title (cloned from <title>)",
      });
    }
    if (effectiveDescription && !current.ogDescription) {
      patches.push({
        type: "meta_tag_edit",
        target: "og:description",
        before: "",
        after: effectiveDescription,
        rationale: "Add og:description (cloned from meta description)",
      });
    }
    if (!current.ogType) {
      patches.push({
        type: "meta_tag_edit",
        target: "og:type",
        before: "",
        after: "article",
        rationale: "Add og:type (default to 'article' for blog content)",
      });
    }
  }

  return { patches, cost };
}
