import type { AuditInput, Finding } from "../../types.js";
import { visibleText } from "../../shared-lib/validators.js";

const BANNED_WORDS = [
  "delve",
  "navigate",
  "leverage",
  "robust",
  "tapestry",
  "testament",
  "seamlessly",
  "elevate",
  "unleash",
  "paramount",
  "myriad",
  "cornerstone",
  "pivotal",
  "foster",
  "underscore",
  "realm",
  "bustling",
];

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
  "it is worth noting",
  "generally speaking",
  "broadly speaking",
  "in essence",
  "fundamentally",
];

const TRANSITION_WORDS = [
  "moreover",
  "furthermore",
  "additionally",
  "consequently",
  "nevertheless",
  "notwithstanding",
];

const OPENERS_LLM = [
  /^in this/i,
  /^when it comes to/i,
  /^it's worth noting/i,
  /^in today's/i,
  /^in the world of/i,
  /^in the realm of/i,
  /^whether you're/i,
  /^look no further/i,
];

const TRICOLON_RX = /\b\w+(?:ly)?,\s+\w+(?:ly)?,\s+and\s+\w+/gi;
const NOT_X_BUT_Y_RX = /\bit'?s not (?:just |only |merely )?(?:about |a |an |the )?[^,.]*?(?:,|—|-) it'?s /gi;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function paragraphs(html: string): string[] {
  return visibleText(html)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function countMatches(text: string, rx: RegExp): number {
  return (text.match(rx) ?? []).length;
}

function countWordOccurrences(text: string, words: string[]): { word: string; count: number }[] {
  const lower = text.toLowerCase();
  return words
    .map((w) => {
      const rx = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      return { word: w, count: (lower.match(rx) ?? []).length };
    })
    .filter((x) => x.count > 0);
}

function stddev(nums: number[]): number {
  if (!nums.length) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

export interface HumanizationSignalReport {
  wordCount: number;
  score: number;
  findings: Finding[];
  metrics: Record<string, number>;
}

export function computeHumanizationSignals(input: AuditInput): HumanizationSignalReport {
  const text = visibleText(input.articleBodyHtml || input.html);
  const sents = sentences(text);
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length || 1;
  const per500 = (n: number) => (n / wordCount) * 500;
  const findings: Finding[] = [];
  const metrics: Record<string, number> = {};

  const emDashes = countMatches(text, /—/g);
  metrics.em_dashes_per_400 = (emDashes / wordCount) * 400;
  if (metrics.em_dashes_per_400 > 1.25) {
    findings.push({
      checkId: "H_em_dash_overuse",
      layer: "humanization",
      severity: "warn",
      evidence: `${emDashes} em-dashes (${metrics.em_dashes_per_400.toFixed(2)} per 400 words; target <1)`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }

  const notXButY = countMatches(text, NOT_X_BUT_Y_RX);
  metrics.not_x_but_y = notXButY;
  if (notXButY > 1) {
    findings.push({
      checkId: "H_not_x_but_y",
      layer: "humanization",
      severity: "warn",
      evidence: `${notXButY} "it's not X, it's Y" constructions (target ≤1)`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }

  const tricolons = countMatches(text, TRICOLON_RX);
  metrics.tricolons_per_500 = per500(tricolons);
  if (metrics.tricolons_per_500 > 2) {
    findings.push({
      checkId: "H_tricolon_density",
      layer: "humanization",
      severity: "warn",
      evidence: `${tricolons} tricolons (${metrics.tricolons_per_500.toFixed(2)}/500 words; target ≤2)`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }

  const sentLengths = sents.map((s) => s.split(/\s+/).filter(Boolean).length);
  const meanLen = sentLengths.reduce((a, b) => a + b, 0) / (sentLengths.length || 1);
  const sd = stddev(sentLengths);
  metrics.burstiness = meanLen > 0 ? sd / meanLen : 0;
  if (metrics.burstiness < 0.55 && sents.length > 5) {
    findings.push({
      checkId: "H_low_burstiness",
      layer: "humanization",
      severity: "warn",
      evidence: `Sentence-length burstiness ${metrics.burstiness.toFixed(2)} (target ≥0.55) — rhythm too uniform`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }

  const paras = paragraphs(input.articleBodyHtml || input.html);
  const opens = paras.map((p) => p.split(/\s+/).slice(0, 2).join(" ").toLowerCase());
  const uniqueOpens = new Set(opens).size;
  metrics.opener_diversity = paras.length ? uniqueOpens / paras.length : 1;
  if (paras.length >= 4 && metrics.opener_diversity < 0.7) {
    findings.push({
      checkId: "H_repetitive_openers",
      layer: "humanization",
      severity: "warn",
      evidence: `Paragraph-opener diversity ${(metrics.opener_diversity * 100).toFixed(0)}% (target ≥70%)`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }

  const llmOpenerHits = paras.filter((p) => OPENERS_LLM.some((rx) => rx.test(p))).length;
  metrics.llm_opener_count = llmOpenerHits;
  if (llmOpenerHits > 0) {
    findings.push({
      checkId: "H_llm_opener_phrases",
      layer: "humanization",
      severity: "warn",
      evidence: `${llmOpenerHits} paragraph(s) open with LLM-signature phrases (In this..., When it comes to..., It's worth noting...)`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }

  const hedgeHits = countWordOccurrences(text, HEDGE_WORDS);
  const hedgeTotal = hedgeHits.reduce((a, b) => a + b.count, 0);
  metrics.hedges_per_500 = per500(hedgeTotal);
  if (metrics.hedges_per_500 > 3) {
    findings.push({
      checkId: "H_hedge_overuse",
      layer: "humanization",
      severity: "warn",
      evidence: `${hedgeTotal} hedge words (${metrics.hedges_per_500.toFixed(1)}/500; target ≤3): ${hedgeHits
        .map((h) => `${h.word}(${h.count})`)
        .join(", ")}`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }

  const transHits = countWordOccurrences(text, TRANSITION_WORDS);
  const transTotal = transHits.reduce((a, b) => a + b.count, 0);
  metrics.transitions_per_500 = per500(transTotal);
  if (metrics.transitions_per_500 > 2) {
    findings.push({
      checkId: "H_formal_transition_overuse",
      layer: "humanization",
      severity: "warn",
      evidence: `${transTotal} formal transitions (${metrics.transitions_per_500.toFixed(1)}/500; target ≤2): ${transHits
        .map((h) => `${h.word}(${h.count})`)
        .join(", ")}`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }

  const bannedHits = countWordOccurrences(text, BANNED_WORDS);
  metrics.banned_word_count = bannedHits.reduce((a, b) => a + b.count, 0);
  if (bannedHits.length) {
    findings.push({
      checkId: "H_banned_vocabulary",
      layer: "humanization",
      severity: "fail",
      evidence: `AI-signature vocabulary present: ${bannedHits.map((h) => `${h.word}(${h.count})`).join(", ")}`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
  }

  const lower = text.toLowerCase();
  const phraseHits = BANNED_PHRASES.filter((p) => lower.includes(p));
  metrics.banned_phrase_count = phraseHits.length;
  if (phraseHits.length) {
    findings.push({
      checkId: "H_banned_phrases",
      layer: "humanization",
      severity: "fail",
      evidence: `AI-signature phrases present (${phraseHits.length}): ${phraseHits.slice(0, 5).join('", "')}${phraseHits.length > 5 ? "..." : ""}`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
  }

  const passive = countMatches(text, /\b(is|are|was|were|be|been|being)\s+\w+ed\b/gi);
  metrics.passive_ratio = passive / (sents.length || 1);
  if (metrics.passive_ratio > 0.15 && sents.length > 8) {
    findings.push({
      checkId: "H_passive_overuse",
      layer: "humanization",
      severity: "warn",
      evidence: `Passive-voice ratio ${(metrics.passive_ratio * 100).toFixed(0)}% (target <15%)`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "heuristic",
    });
  }

  const questions = countMatches(text, /[^.!?]*\?/g);
  metrics.questions_per_400 = (questions / wordCount) * 400;
  if (wordCount > 400 && metrics.questions_per_400 < 1) {
    findings.push({
      checkId: "H_no_questions",
      layer: "humanization",
      severity: "info",
      evidence: `${questions} question(s) — consider adding rhetorical questions for human voice`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "heuristic",
    });
  }

  const firstPerson = countMatches(text, /\b(I|I'm|I've|I'd|I'll|my|me)\b/g);
  metrics.first_person_count = firstPerson;

  const numbers = countMatches(text, /\b\d+([.,]\d+)?(%|k|K|M|B)?\b/g);
  metrics.numbers_per_500 = per500(numbers);
  if (wordCount > 500 && metrics.numbers_per_500 < 4) {
    findings.push({
      checkId: "H_low_specificity_numbers",
      layer: "humanization",
      severity: "info",
      evidence: `${numbers} concrete numbers (${metrics.numbers_per_500.toFixed(1)}/500; target ≥4) — add specifics`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "heuristic",
    });
  }

  const paraLens = paras.map((p) => sentences(p).length);
  metrics.para_length_sd = stddev(paraLens);
  if (paras.length >= 4 && metrics.para_length_sd < 1.5) {
    findings.push({
      checkId: "H_uniform_paragraphs",
      layer: "humanization",
      severity: "warn",
      evidence: `Paragraph-length stddev ${metrics.para_length_sd.toFixed(2)} (target ≥1.5) — too uniform`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }

  let score = 100;
  for (const f of findings) {
    if (f.severity === "fail") score -= 15;
    else if (f.severity === "warn") score -= 6;
    else score -= 2;
  }
  score = Math.max(0, score);

  return { wordCount, score, findings, metrics };
}
