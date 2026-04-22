import { parse } from "node-html-parser";
import type { AuditInput, ParagraphMetric } from "../types.js";

const BANNED_PHRASES = [
  "in today's fast-paced world",
  "in today's world",
  "in today's digital age",
  "it's important to note",
  "it is important to note",
  "in this comprehensive guide",
  "this comprehensive guide",
  "the key to success is",
  "let's dive in",
  "let's dive into",
  "by the end of this article",
  "in summary,",
  "in conclusion,",
  "at the end of the day",
  "game-changing",
  "revolutionary",
  "cutting-edge",
  "dramatically shifted",
  "fundamentally shifted",
  "ever-evolving",
  "ever-changing landscape",
];

const HEDGE_WORDS = [
  "perhaps",
  "arguably",
  "it's worth noting",
  "generally speaking",
  "broadly speaking",
  "in essence",
  "fundamentally",
];

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countOccurrences(text: string, needle: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  let i = 0;
  while (true) {
    const at = lower.indexOf(needle, i);
    if (at < 0) break;
    count++;
    i = at + needle.length;
  }
  return count;
}

function computeOne(text: string, index: number): ParagraphMetric {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const sents = sentences(cleaned);
  const wc = cleaned.split(/\s+/).filter(Boolean).length;
  const avgSentenceWords = sents.length
    ? Math.round((wc / sents.length) * 10) / 10
    : 0;

  const lower = cleaned.toLowerCase();
  let bannedHits = 0;
  for (const p of BANNED_PHRASES) bannedHits += countOccurrences(cleaned, p);
  let hedgeHits = 0;
  for (const h of HEDGE_WORDS) hedgeHits += countOccurrences(cleaned, h);

  const emDashes = (cleaned.match(/—/g) ?? []).length;
  const firstPerson = /\b(I|I'm|I've|we|we're|we've|our)\b/.test(cleaned);
  const hasQuestion = /\?/.test(cleaned);
  const passiveHits = (cleaned.match(/\b(is|are|was|were|be|been|being)\s+\w+ed\b/gi) ?? []).length;
  const concreteNumbers = (cleaned.match(/\b\d+([.,]\d+)?(%|k|K|M|B)?\b/g) ?? []).length;

  const issueFlags: string[] = [];
  if (wc > 80) issueFlags.push(`long-paragraph(${wc}w)`);
  if (sents.length > 4) issueFlags.push(`many-sentences(${sents.length})`);
  if (avgSentenceWords > 26) issueFlags.push(`sentence-avg-too-long(${avgSentenceWords}w)`);
  if (bannedHits > 0) issueFlags.push(`banned-phrase(${bannedHits})`);
  if (hedgeHits > 1) issueFlags.push(`hedges(${hedgeHits})`);
  if (emDashes > 1) issueFlags.push(`em-dashes(${emDashes})`);
  if (wc > 30 && passiveHits / sents.length > 0.3) issueFlags.push("passive-heavy");

  const firstWords = cleaned.split(/\s+/).slice(0, 8).join(" ");

  return {
    index,
    firstWords: firstWords + (cleaned.length > firstWords.length ? "…" : ""),
    wordCount: wc,
    sentenceCount: sents.length,
    avgSentenceWords,
    emDashes,
    bannedPhraseHits: bannedHits,
    hedgeHits,
    firstPerson,
    hasQuestion,
    passiveHits,
    concreteNumbers,
    issueFlags,
  };
}

export function computeParagraphMetrics(input: AuditInput): ParagraphMetric[] {
  const html = input.articleBodyHtml || input.html;
  if (!html) return [];
  const root = parse(html);
  const blocks = root.querySelectorAll("article p, main p, p");
  const seen = new Set<string>();
  const metrics: ParagraphMetric[] = [];
  let idx = 0;
  for (const b of blocks) {
    const text = b.text.trim();
    if (!text || seen.has(text)) continue;
    if (text.split(/\s+/).length < 8) continue;
    seen.add(text);
    metrics.push(computeOne(text, idx++));
  }
  return metrics;
}
