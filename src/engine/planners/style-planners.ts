import { parse, type HTMLElement } from "node-html-parser";
import type { Patch } from "../../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Document-wide style planners.
//
// These produce paragraph-scoped Patch envelopes for findings that flag
// distribution-level issues (em-dashes everywhere, tricolons everywhere,
// passive voice everywhere). Key constraints:
//
//   • Each patch's `before` must be unique in the HTML (shakes-peer's
//     apply-patch handler enforces exactly-once occurrence).
//   • Paragraph-scoped is the right granularity — uniqueness usually holds
//     at paragraph level, and one patch atomically fixes multiple
//     occurrences within that paragraph (avoids sequential-drift).
//   • Shakes-peer applies these; blog-buster does NOT (moving toward the
//     clean-split architecture per docs/shakespeer-coherence-brief.md §Phase 2).
// ─────────────────────────────────────────────────────────────────────────────

const TRICOLON_RX = /\b\w+(?:ly)?,\s+\w+(?:ly)?,\s+and\s+\w+/i;
const PASSIVE_RX = /\b(is|are|was|were|be|been|being)\s+\w+ed\b/i;

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let i = 0;
  while (true) {
    const at = haystack.indexOf(needle, i);
    if (at < 0) break;
    count++;
    i = at + needle.length;
  }
  return count;
}

function textParagraphs(root: HTMLElement): HTMLElement[] {
  const scope =
    root.querySelector("article") ??
    root.querySelector("main") ??
    root;
  return scope.querySelectorAll("p");
}

export function planEmDashPatches(html: string): Patch[] {
  if (!html || !html.includes("—")) return [];
  const root = parse(html);
  const patches: Patch[] = [];
  const seen = new Set<string>();

  for (const p of textParagraphs(root)) {
    const innerHtml = p.innerHTML;
    if (!innerHtml.includes("—")) continue;
    if (seen.has(innerHtml)) continue;
    seen.add(innerHtml);
    if (countOccurrences(html, innerHtml) !== 1) continue;

    // Replace " — " (spaced) with ", "; bare "—" → ", ".
    // The spaced form is the common AI-tell; the unspaced form appears
    // in numeric ranges (e.g. "1990—2020") and should also relax to comma.
    const next = innerHtml.replace(/\s—\s/g, ", ").replace(/—/g, ", ");
    if (next === innerHtml) continue;

    patches.push({
      type: "replace_span",
      target: "em-dash-removal",
      before: innerHtml,
      after: next,
      rationale:
        "Remove em-dashes from paragraph (reduces AI-signature density; commas preserve meaning)",
    });
  }
  return patches;
}

interface SentenceTarget {
  paragraphInnerHtml: string;
  sentenceText: string;
  reason: string;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function topOffendingParagraphs(
  html: string,
  matcher: (sentence: string) => boolean,
  reasonBuilder: (sentence: string) => string,
  cap: number,
): SentenceTarget[] {
  const root = parse(html);
  const out: SentenceTarget[] = [];
  const seen = new Set<string>();

  for (const p of textParagraphs(root)) {
    const innerHtml = p.innerHTML;
    if (seen.has(innerHtml)) continue;
    seen.add(innerHtml);
    const text = p.text.trim();
    if (!text) continue;
    const sentences = splitSentences(text);
    for (const s of sentences) {
      if (matcher(s)) {
        if (countOccurrences(html, innerHtml) !== 1) break;
        out.push({
          paragraphInnerHtml: innerHtml,
          sentenceText: s,
          reason: reasonBuilder(s),
        });
        break; // one per paragraph is enough for the outer cap
      }
    }
    if (out.length >= cap) break;
  }
  return out;
}

export function planTricolonRewrites(html: string, cap = 5): Patch[] {
  const targets = topOffendingParagraphs(
    html,
    (s) => TRICOLON_RX.test(s),
    (s) => `Tricolon cadence ("X, Y, and Z") in sentence: "${s.slice(0, 100)}..." Rewrite to vary rhythm — keep meaning, avoid another three-item list.`,
    cap,
  );
  return targets.map((t) => ({
    type: "rewrite_paragraph",
    target: "tricolon-reduction",
    before: t.paragraphInnerHtml,
    after: "",
    rationale: t.reason,
  }));
}

export function planPassiveRewrites(html: string, cap = 5): Patch[] {
  const targets = topOffendingParagraphs(
    html,
    (s) => PASSIVE_RX.test(s),
    (s) => `Passive voice in sentence: "${s.slice(0, 100)}..." Rewrite in active voice — same facts, same claim, clearer agent.`,
    cap,
  );
  return targets.map((t) => ({
    type: "rewrite_paragraph",
    target: "passive-to-active",
    before: t.paragraphInnerHtml,
    after: "",
    rationale: t.reason,
  }));
}

/**
 * Extend a `before` fragment with surrounding context from the HTML until it
 * appears exactly once. Used to disambiguate LLM-judge patches whose quoted
 * sentence may appear multiple times in the document.
 *
 * Returns null if the fragment can't be made unique within maxExtensions steps.
 */
export function makeFragmentUnique(
  fragment: string,
  html: string,
  maxExtensions = 5,
): { before: string; prefix: string; suffix: string } | null {
  let occ = countOccurrences(html, fragment);
  if (occ === 0) return null;
  if (occ === 1) return { before: fragment, prefix: "", suffix: "" };

  let prefix = "";
  let suffix = "";
  for (let attempt = 0; attempt < maxExtensions; attempt++) {
    // Find the first occurrence and extend by ~20 chars each side.
    const idx = html.indexOf(fragment);
    if (idx < 0) return null;
    const left = html.slice(Math.max(0, idx - 20 * (attempt + 1)), idx);
    const right = html.slice(
      idx + fragment.length,
      Math.min(html.length, idx + fragment.length + 20 * (attempt + 1)),
    );
    prefix = left;
    suffix = right;
    const extended = prefix + fragment + suffix;
    occ = countOccurrences(html, extended);
    if (occ === 1) return { before: extended, prefix, suffix };
  }
  return null;
}
