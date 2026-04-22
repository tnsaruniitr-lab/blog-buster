import { parse, HTMLElement } from "node-html-parser";

const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "head"]);

export function visibleText(html: string, maxChars = 50_000): string {
  if (!html) return "";
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  const parts: string[] = [];
  const walk = (el: HTMLElement) => {
    if (SKIP_TAGS.has(el.rawTagName?.toLowerCase() ?? "")) return;
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        parts.push((child as unknown as { rawText: string }).rawText);
      } else if (child.nodeType === 1) {
        walk(child as HTMLElement);
      }
    }
  };
  walk(root);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

export function visibleWordCount(html: string): number {
  return visibleText(html).split(/\s+/).filter(Boolean).length;
}

const QUESTION_OPENERS = new Set([
  "how",
  "what",
  "why",
  "when",
  "where",
  "who",
  "which",
  "can",
  "do",
  "does",
  "is",
  "are",
  "should",
  "will",
  "would",
  "could",
  "did",
]);

export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;
  const first = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/[^\w]/g, "");
  return first ? QUESTION_OPENERS.has(first) : false;
}

export function faqVisibleCount(html: string): number {
  if (!html) return 0;
  const root = parse(html);
  const candidates = root.querySelectorAll("h2, h3, h4, strong, summary, dt");
  let count = 0;
  for (const node of candidates) {
    if (looksLikeQuestion(node.text)) count++;
  }
  return count;
}

export function extractSchemaBlocks(html: string): unknown[] {
  if (!html) return [];
  const root = parse(html);
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  const blocks: unknown[] = [];
  for (const s of scripts) {
    const raw = s.text.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      blocks.push(parsed);
    } catch {
      // skip malformed block, flagged separately as a finding
    }
  }
  return blocks;
}

export function flattenEntities(blocks: unknown[]): Record<string, unknown>[] {
  const entities: Record<string, unknown>[] = [];
  const push = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n)) {
      for (const item of n) push(item);
      return;
    }
    if ("@graph" in n && Array.isArray(n["@graph"])) {
      for (const item of n["@graph"] as unknown[]) push(item);
    }
    if ("@type" in n) entities.push(n);
  };
  for (const b of blocks) push(b);
  return entities;
}

export function entityTypes(entity: Record<string, unknown>): string[] {
  const t = entity["@type"];
  if (!t) return [];
  return Array.isArray(t) ? (t as string[]) : [t as string];
}

export interface FieldValidationResult {
  entityType: string;
  missingRequired: string[];
  missingGoogleRequired: string[];
  missingRecommended: string[];
  customFailures: string[];
  hasStableId: boolean;
}

export function detectSpaSignals(html: string): {
  framework: string | null;
  hydrationShell: boolean;
} {
  const lower = html.toLowerCase();
  const signals = [
    { framework: "next.js", markers: ["__next_data__", "/_next/"] },
    { framework: "nuxt", markers: ["__nuxt__", "/_nuxt/"] },
    { framework: "react", markers: ["data-reactroot", 'id="root"'] },
    { framework: "vue", markers: ["data-v-app", "data-v-"] },
    { framework: "svelte", markers: ["svelte-"] },
  ];
  for (const s of signals) {
    if (s.markers.some((m) => lower.includes(m))) {
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const bodyText = bodyMatch
        ? bodyMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : "";
      return { framework: s.framework, hydrationShell: bodyText.length < 400 };
    }
  }
  return { framework: null, hydrationShell: false };
}

export function detectHreflang(html: string): { count: number; tags: string[] } {
  if (!html) return { count: 0, tags: [] };
  const root = parse(html);
  const links = root.querySelectorAll('link[rel="alternate"][hreflang]');
  const tags = links.map((l) => l.getAttribute("hreflang") ?? "").filter(Boolean);
  return { count: tags.length, tags };
}
