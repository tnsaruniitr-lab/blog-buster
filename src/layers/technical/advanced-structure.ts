import { parse, HTMLElement } from "node-html-parser";
import type { AuditInput, Finding } from "../../types.js";
import { POST_TYPE_BANDS } from "../../input/post-type.js";
import { visibleText } from "../../shared-lib/validators.js";

const REFERENTIAL_RX =
  /\b(as mentioned (?:earlier|above|previously)|as discussed (?:earlier|above|previously)|we discussed above|see (?:below|above|the section)|in the (?:previous|above) section)\b/i;

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function firstSentence(s: string): string {
  const m = s.trim().match(/^([^.!?]+[.!?])/);
  return m ? m[1].trim() : s.trim();
}

function h2Headings(root: HTMLElement): HTMLElement[] {
  return root.querySelectorAll("h2");
}

function wordsBetween(root: HTMLElement, a: HTMLElement, b: HTMLElement | null): string {
  const chunks: string[] = [];
  let collecting = false;
  const walk = (el: HTMLElement) => {
    for (const child of el.childNodes) {
      if (child.nodeType === 1) {
        const c = child as HTMLElement;
        if (c === a) {
          collecting = true;
          continue;
        }
        if (c === b) {
          collecting = false;
          return;
        }
        if (collecting) {
          chunks.push(c.text);
        }
        walk(c);
      }
    }
  };
  walk(root);
  return chunks.join(" ");
}

export function auditTldrBlock(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const root = parse(input.html);
  let block = root.querySelector("p[data-tldr]");
  let note = "";
  if (!block) {
    const candidates = root.querySelectorAll("p, div");
    for (const c of candidates) {
      const txt = c.text.trim();
      if (!txt) continue;
      if (/^tl;?dr[:\s]/i.test(txt) || /^summary[:\s]/i.test(txt)) {
        block = c;
        note = " (found via 'TL;DR:' prefix, but missing data-tldr attribute)";
        break;
      }
    }
  }

  if (!block) {
    findings.push({
      checkId: "S_tldr_missing",
      layer: "technical",
      severity: "fail",
      evidence: "No TL;DR block (expected <p data-tldr> or paragraph starting with 'TL;DR:')",
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
    return findings;
  }

  const text = block.text.replace(/^tl;?dr[:\s]+/i, "").trim();
  const words = wordCount(text);
  if (words < 40 || words > 58) {
    findings.push({
      checkId: "S_tldr_word_count",
      layer: "technical",
      severity: "warn",
      evidence: `TL;DR is ${words} words (target 40–58)${note}`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "static",
    });
  }

  if (input.primaryKeyword) {
    const first8 = text.split(/\s+/).slice(0, 8).join(" ").toLowerCase();
    const kw = input.primaryKeyword.toLowerCase();
    const kwCore = kw.split(/\s+/).slice(0, 3).join(" ");
    if (!first8.includes(kwCore)) {
      findings.push({
        checkId: "S_tldr_keyword_position",
        layer: "technical",
        severity: "warn",
        evidence: `Primary keyword "${input.primaryKeyword}" not in first 8 words of TL;DR`,
        sieveRules: [],
        sieveAps: [],
        truthBadge: "static",
      });
    }
  }

  if (note) {
    findings.push({
      checkId: "S_tldr_attribute_missing",
      layer: "technical",
      severity: "info",
      evidence: "TL;DR block present but missing data-tldr attribute (helps LLM extraction)",
      sieveRules: [],
      sieveAps: [],
      truthBadge: "static",
    });
  }

  return findings;
}

export function auditH2QuestionRatio(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const root = parse(input.html);
  const h2s = h2Headings(root);
  if (h2s.length < 3) return findings;
  const questions = h2s.filter((h) => h.text.trim().endsWith("?")).length;
  const ratio = questions / h2s.length;
  if (ratio < 0.4) {
    findings.push({
      checkId: "S_h2_question_ratio_low",
      layer: "technical",
      severity: "warn",
      evidence: `${questions}/${h2s.length} H2s are questions (${Math.round(ratio * 100)}% — target ≥40%)`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "static",
    });
  }
  return findings;
}

export function auditStructuralDensity(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const words = input.wordCount ?? visibleText(input.html).split(/\s+/).filter(Boolean).length;
  if (words < 500) return findings;
  const root = parse(input.html);
  const tables = root.querySelectorAll("table").length;
  const ols = root.querySelectorAll("ol").length;
  const bigUls = root
    .querySelectorAll("ul")
    .filter((ul) => ul.querySelectorAll("li").length > 3).length;
  const structural = tables + ols + bigUls;
  const expected = Math.floor(words / 500);
  if (structural < expected) {
    findings.push({
      checkId: "S_structural_density_low",
      layer: "technical",
      severity: "warn",
      evidence: `${structural} structural element(s) for ${words} words — target ≥${expected} (1 table/ol/ul>3 per 500 words)`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }
  return findings;
}

export function auditSectionSizeCap(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const root = parse(input.html);
  const h2s = h2Headings(root);
  if (h2s.length < 2) return findings;
  let flagged = 0;
  for (let i = 0; i < h2s.length; i++) {
    const next = h2s[i + 1] ?? null;
    const between = wordsBetween(root, h2s[i], next);
    const between_wc = wordCount(between);
    if (between_wc > 500) {
      const h3s =
        next === null
          ? 0
          : 1;
      if (h3s === 0) {
        flagged++;
      }
    }
  }
  if (flagged > 0) {
    findings.push({
      checkId: "S_section_too_large",
      layer: "technical",
      severity: "warn",
      evidence: `${flagged} H2 section(s) exceed 500 words without H3 subsections`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }
  return findings;
}

export function auditH2Extractability(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const root = parse(input.html);
  const h2s = h2Headings(root);
  const offenders: string[] = [];
  for (const h2 of h2s) {
    let nextText = "";
    let sib = h2.nextElementSibling;
    while (sib && !/^h\d$/i.test(sib.tagName)) {
      if (sib.text.trim()) {
        nextText = sib.text.trim();
        break;
      }
      sib = sib.nextElementSibling;
    }
    if (!nextText) continue;
    const fs = firstSentence(nextText);
    if (REFERENTIAL_RX.test(fs)) {
      offenders.push(h2.text.trim().slice(0, 50));
    }
  }
  if (offenders.length) {
    findings.push({
      checkId: "S_h2_referential_phrases",
      layer: "technical",
      severity: "fail",
      evidence: `${offenders.length} H2 section(s) open with referential phrases (breaks standalone extractability): ${offenders.slice(0, 3).join("; ")}`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
  }
  return findings;
}

export function auditVisibleLastUpdated(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const text = visibleText(input.html).toLowerCase();
  // Handshake §3.3: also catch "Next review" / "Review by" stamps so this
  // check covers shakespeer's F7 (Last Reviewed + Next Review) in full.
  const hasLastUpdated =
    /last updated[:\s]|updated:\s|updated on\s|last revised/.test(text);
  const hasReviewStamp =
    /last reviewed[:\s]|reviewed on\s|next review[:\s]|review by\s|review date[:\s]/.test(
      text,
    );
  const hasWrittenDate =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+20\d{2}/i.test(
      visibleText(input.html),
    );
  const hasMarker = hasLastUpdated || hasReviewStamp || hasWrittenDate;
  if (!hasMarker) {
    findings.push({
      checkId: "S_visible_last_updated_missing",
      layer: "technical",
      severity: "warn",
      evidence:
        "No visible 'Last updated' / 'Last reviewed' / 'Next review' stamp on page (schema dateModified alone isn't enough for users or AI)",
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
  }
  return findings;
}

export function auditTableOfContents(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const band = POST_TYPE_BANDS[input.postType];
  if (!band.recommendsTOC) return findings;
  const words = input.wordCount ?? visibleText(input.html).split(/\s+/).filter(Boolean).length;
  if (words < 1500) return findings;
  const root = parse(input.html);
  const tocNav = root.querySelector('nav[aria-label*="contents" i], nav[aria-label*="toc" i], nav.toc, #toc');
  if (!tocNav) {
    findings.push({
      checkId: "S_toc_missing",
      layer: "technical",
      severity: "warn",
      evidence: `Post is ${words} words (${input.postType}) — include a <nav aria-label="Table of contents"> for LLM outline extraction`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "static",
    });
  }
  return findings;
}

export function auditWordCountBand(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const words = input.wordCount ?? visibleText(input.html).split(/\s+/).filter(Boolean).length;
  const band = POST_TYPE_BANDS[input.postType];
  if (words < band.minWords) {
    findings.push({
      checkId: "S_word_count_below_band",
      layer: "technical",
      severity: "fail",
      evidence: `${words} words is below ${input.postType} minimum ${band.minWords} (target ${band.targetWords})`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
  } else if (words > band.maxWords) {
    findings.push({
      checkId: "S_word_count_above_band",
      layer: "technical",
      severity: "warn",
      evidence: `${words} words exceeds ${input.postType} maximum ${band.maxWords} (target ${band.targetWords}) — readers drop`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "static",
    });
  }
  return findings;
}

export function auditPostTypeSchema(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const band = POST_TYPE_BANDS[input.postType];
  if (!band.requiredSchemaTypes.length) return findings;
  const presentTypes = new Set<string>();
  for (const s of input.schemas) {
    const o = s as Record<string, unknown>;
    const t = o?.["@type"];
    if (typeof t === "string") presentTypes.add(t);
    else if (Array.isArray(t)) for (const tt of t) presentTypes.add(String(tt));
  }
  for (const needed of band.requiredSchemaTypes) {
    if (!presentTypes.has(needed)) {
      findings.push({
        checkId: `S_missing_${needed}_schema`,
        layer: "technical",
        severity: "fail",
        evidence: `${input.postType} posts should have ${needed} schema — not present`,
        sieveRules: [],
        sieveAps: [],
        truthBadge: "static",
      });
    }
  }
  return findings;
}

export function runAdvancedStructure(input: AuditInput): Finding[] {
  return [
    ...auditTldrBlock(input),
    ...auditH2QuestionRatio(input),
    ...auditStructuralDensity(input),
    ...auditSectionSizeCap(input),
    ...auditH2Extractability(input),
    ...auditVisibleLastUpdated(input),
    ...auditTableOfContents(input),
    ...auditWordCountBand(input),
    ...auditPostTypeSchema(input),
  ];
}
