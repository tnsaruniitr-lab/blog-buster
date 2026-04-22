import { parse } from "node-html-parser";
import type { AuditInput, Finding } from "../../types.js";
import {
  extractSchemaBlocks,
  flattenEntities,
  entityTypes,
  visibleText,
} from "../../shared-lib/validators.js";

const FIRST_PARTY_DATA_RX =
  /\b(we|our)\s+(tested|measured|analy[sz]ed|tracked|surveyed|audited|reviewed|ran|benchmarked|found|discovered|built|ship(?:ped)?|deployed|launched|studied|observed|compared|monitored|sampled|interviewed)\b/gi;

const AUTHOR_BYLINE_SELECTORS = [
  '[rel="author"]',
  '[itemprop="author"]',
  ".author",
  ".byline",
  ".post-author",
  ".article-author",
  "address.author",
];

function findPersonEntity(schemas: unknown[]): Record<string, unknown> | null {
  const entities = flattenEntities(schemas);
  const directPerson = entities.find((e) => entityTypes(e).includes("Person"));
  if (directPerson) return directPerson;
  const article = entities.find((e) =>
    entityTypes(e).some((t) => ["Article", "BlogPosting", "NewsArticle"].includes(t)),
  );
  const author = article?.author;
  if (!author) return null;
  if (Array.isArray(author)) {
    const p = author.find((a) => {
      const ao = a as Record<string, unknown>;
      return ao["@type"] === "Person";
    });
    return (p as Record<string, unknown>) ?? null;
  }
  if (typeof author === "object") {
    return author as Record<string, unknown>;
  }
  return null;
}

function hasVisibleByline(html: string): boolean {
  const root = parse(html);
  for (const sel of AUTHOR_BYLINE_SELECTORS) {
    const n = root.querySelector(sel);
    if (n && n.text.trim().length > 0) return true;
  }
  const text = visibleText(html).slice(0, 3000);
  return /\bby\s+[A-Z][a-z]+\s+[A-Z][a-z]+/.test(text);
}

function findOriginalVisualSignal(html: string): boolean {
  const root = parse(html);
  const imgs = root.querySelectorAll("img");
  for (const img of imgs) {
    const src = (img.getAttribute("src") ?? "").toLowerCase();
    const alt = (img.getAttribute("alt") ?? "").toLowerCase();
    if (/screenshot|diagram|chart|figure|graph/.test(src + " " + alt)) return true;
    if (/\.(png|jpg|webp)$/i.test(src) && !/stock|getty|unsplash|pexels/.test(src)) {
      return true;
    }
  }
  const hasSvgChart = !!root.querySelector("svg, figure figcaption");
  return hasSvgChart;
}

function countOutboundCitationLinks(html: string, ownDomain: string | null): number {
  const root = parse(html);
  const anchors = root.querySelectorAll("a[href]");
  let count = 0;
  for (const a of anchors) {
    const href = a.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) continue;
    if (ownDomain && href.toLowerCase().includes(ownDomain.toLowerCase())) continue;
    count++;
  }
  return count;
}

function brandDomain(brand: string, metadata: Record<string, unknown>): string | null {
  const m = metadata as { brand?: { website?: string } };
  const url = m.brand?.website;
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function runEeatLayer(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const schemas = input.schemas.length ? input.schemas : extractSchemaBlocks(input.html);
  const person = findPersonEntity(schemas);

  if (!person) {
    findings.push({
      checkId: "E_author_person_missing",
      layer: "eeat",
      severity: "critical",
      evidence: "No Person/author entity in JSON-LD — top AI-content-flag trigger",
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
  } else {
    if (!person.name) {
      findings.push({
        checkId: "E_author_name_missing",
        layer: "eeat",
        severity: "critical",
        evidence: "Author Person entity has no name field",
        sieveRules: [],
        sieveAps: [],
        truthBadge: "hard",
      });
    }
    const sameAs = person.sameAs;
    const sameAsArr = Array.isArray(sameAs) ? (sameAs as string[]) : sameAs ? [sameAs as string] : [];
    if (sameAsArr.length === 0) {
      findings.push({
        checkId: "E_author_sameas_missing",
        layer: "eeat",
        severity: "critical",
        evidence: "Author has no sameAs URLs (should link LinkedIn + at least one other profile)",
        sieveRules: [],
        sieveAps: [],
        truthBadge: "hard",
      });
    } else {
      const hasLinkedIn = sameAsArr.some((u) => /linkedin\.com/i.test(String(u)));
      if (!hasLinkedIn) {
        findings.push({
          checkId: "E_author_linkedin_missing",
          layer: "eeat",
          severity: "fail",
          evidence: `Author sameAs has ${sameAsArr.length} URL(s) but no LinkedIn — the primary human-signal verifier`,
          sieveRules: [],
          sieveAps: [],
          truthBadge: "hard",
        });
      }
      if (sameAsArr.length < 2) {
        findings.push({
          checkId: "E_author_sameas_thin",
          layer: "eeat",
          severity: "warn",
          evidence: `Author sameAs has only 1 URL; target ≥2 distinct profiles`,
          sieveRules: [],
          sieveAps: [],
          truthBadge: "static",
        });
      }
    }
    if (!person.jobTitle && !person.description) {
      findings.push({
        checkId: "E_author_credentials_missing",
        layer: "eeat",
        severity: "warn",
        evidence: "Author has no jobTitle or description — credentials not stated",
        sieveRules: [],
        sieveAps: [],
        truthBadge: "static",
      });
    }
  }

  if (!hasVisibleByline(input.html)) {
    findings.push({
      checkId: "E_visible_byline_missing",
      layer: "eeat",
      severity: "fail",
      evidence: "No visible author byline found in page HTML (rel=author, .author, .byline, or 'By Name Surname')",
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
  }

  const text = visibleText(input.articleBodyHtml || input.html);
  const firstPartyHits = (text.match(FIRST_PARTY_DATA_RX) ?? []).length;
  const signalBundle = {
    author: !!person && !!person.name,
    authorLinkedIn:
      !!person &&
      Array.isArray(person.sameAs) &&
      (person.sameAs as string[]).some((u) => /linkedin\.com/i.test(String(u))),
    firstPartyData: firstPartyHits >= 1,
    originalVisual: findOriginalVisualSignal(input.html),
    outboundCitations: countOutboundCitationLinks(input.html, brandDomain(input.brand, input.metadata)) >= 3,
  };

  const present = Object.values(signalBundle).filter(Boolean).length;
  if (!signalBundle.firstPartyData) {
    findings.push({
      checkId: "E_no_first_party_data",
      layer: "eeat",
      severity: "fail",
      evidence:
        'No first-party data signals ("we tested", "our data shows", "we analyzed"). Add at least one concrete observation',
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }
  if (!signalBundle.originalVisual) {
    findings.push({
      checkId: "E_no_original_visual",
      layer: "eeat",
      severity: "warn",
      evidence: "No original screenshot / diagram / chart detected. Stock-only imagery raises AI-content flag risk",
      sieveRules: [],
      sieveAps: [],
      truthBadge: "heuristic",
    });
  }
  if (!signalBundle.outboundCitations) {
    findings.push({
      checkId: "E_insufficient_outbound_citations",
      layer: "eeat",
      severity: "fail",
      evidence: `Fewer than 3 outbound citations to external sources — weakens trust + reciprocity`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "measured",
    });
  }
  if (present < 4) {
    findings.push({
      checkId: "E_human_signals_bundle_incomplete",
      layer: "eeat",
      severity: "critical",
      evidence: `Only ${present}/4 human signals present (author+LinkedIn=${signalBundle.author && signalBundle.authorLinkedIn}, first-party data=${signalBundle.firstPartyData}, original visual=${signalBundle.originalVisual}, 3+ citations=${signalBundle.outboundCitations}). High AI-content-flag risk`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "heuristic",
    });
  }

  return findings;
}
