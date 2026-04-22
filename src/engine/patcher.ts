import { parse } from "node-html-parser";
import type { AuditInput, Patch } from "../types.js";
import type { PlannedPatch } from "./rewriter.js";
import { llmRewriteSentence } from "./rewriter.js";

export interface PatchApplication {
  applied: Patch[];
  rejected: { patch: Patch; reason: string }[];
  costUsd: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isHtmlValid(html: string): boolean {
  try {
    const root = parse(html);
    return !!root && !!root.querySelector("body");
  } catch {
    return false;
  }
}

export async function applyPatches(
  input: AuditInput,
  planned: PlannedPatch[],
): Promise<{ input: AuditInput; application: PatchApplication }> {
  let html = input.html;
  let articleBody = input.articleBodyHtml;
  const applied: Patch[] = [];
  const rejected: { patch: Patch; reason: string }[] = [];
  let costUsd = 0;

  for (const { patch } of planned) {
    if (patch.type === "replace_span" || patch.type === "rewrite_intro") {
      if (!patch.before || !patch.after) {
        rejected.push({ patch, reason: "empty before/after" });
        continue;
      }
      if (!html.includes(patch.before)) {
        rejected.push({ patch, reason: "target span not found in HTML" });
        continue;
      }
      const nextHtml = html.replace(patch.before, patch.after);
      const nextBody = articleBody.includes(patch.before)
        ? articleBody.replace(patch.before, patch.after)
        : articleBody;
      if (!isHtmlValid(nextHtml)) {
        rejected.push({ patch, reason: "patched HTML failed to parse" });
        continue;
      }
      html = nextHtml;
      articleBody = nextBody;
      applied.push(patch);
      continue;
    }

    if (patch.type === "regex_replace") {
      const rx = new RegExp(escapeRegExp(patch.target) ?? patch.target, "gi");
      const hits = html.match(rx);
      if (!hits) {
        rejected.push({ patch, reason: "no regex matches" });
        continue;
      }
      const sentenceRx = new RegExp(`[^.!?\\n]*\\b${patch.target}\\b[^.!?\\n]*[.!?]`, "i");
      const sentMatch = html.match(sentenceRx);
      if (!sentMatch) {
        rejected.push({ patch, reason: "could not locate enclosing sentence" });
        continue;
      }
      const original = sentMatch[0];
      const { text: rewritten, cost } = await llmRewriteSentence(original);
      costUsd += cost;
      if (!rewritten || rewritten.length < 5) {
        rejected.push({ patch, reason: "LLM rewrite too short" });
        continue;
      }
      const nextHtml = html.replace(original, rewritten);
      if (!isHtmlValid(nextHtml)) {
        rejected.push({ patch, reason: "rewritten HTML failed to parse" });
        continue;
      }
      html = nextHtml;
      if (articleBody.includes(original)) {
        articleBody = articleBody.replace(original, rewritten);
      }
      applied.push({ ...patch, before: original, after: rewritten });
      continue;
    }

    if (patch.type === "meta_tag_edit") {
      rejected.push({ patch, reason: "meta_tag_edit not yet implemented" });
      continue;
    }

    if (patch.type === "insert_schema") {
      rejected.push({ patch, reason: "insert_schema not yet implemented" });
      continue;
    }

    rejected.push({ patch, reason: `unknown patch type ${patch.type}` });
  }

  return {
    input: { ...input, html, articleBodyHtml: articleBody },
    application: { applied, rejected, costUsd },
  };
}
