import { parse } from "node-html-parser";
import type { AuditInput, Finding } from "../../types.js";

// Canonical URL internal consistency — does <link rel="canonical"> match
// the og:url and are both well-formed absolute URLs? Catches the common
// silent failure where a post is deployed at URL A but the canonical points
// at URL B (typically a stale template default).

function readHeadAttr(
  input: AuditInput,
  selector: string,
  attr: string,
): string | null {
  const root = parse(input.html);
  const n = root.querySelector(selector);
  if (!n) return null;
  const v = n.getAttribute(attr);
  return v ? v.trim() : null;
}

function isWellFormedAbsoluteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeForCompare(url: string): string {
  try {
    const u = new URL(url);
    // Strip trailing slash, lowercase host, drop fragment, drop trailing # only
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return url;
  }
}

export function auditCanonicalConsistency(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const canonical = readHeadAttr(input, 'link[rel="canonical"]', "href");
  const ogUrl = readHeadAttr(input, 'meta[property="og:url"]', "content");

  if (!canonical) {
    // A4_canonical_tag (in html-structure.ts) already reports missing canonical.
    // Nothing more to check here.
    return findings;
  }

  if (!isWellFormedAbsoluteUrl(canonical)) {
    findings.push({
      checkId: "A4b_canonical_not_absolute",
      layer: "technical",
      severity: "fail",
      evidence: `<link rel="canonical"> href is not a well-formed absolute https URL: "${canonical}"`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
    return findings;
  }

  if (!ogUrl) {
    findings.push({
      checkId: "A4c_canonical_no_og_url",
      layer: "technical",
      severity: "warn",
      evidence:
        "<link rel=\"canonical\"> present but <meta property=\"og:url\"> missing — recommended to emit both for social + canonical consistency",
      sieveRules: [],
      sieveAps: [],
      truthBadge: "static",
    });
    return findings;
  }

  if (!isWellFormedAbsoluteUrl(ogUrl)) {
    findings.push({
      checkId: "A4d_og_url_not_absolute",
      layer: "technical",
      severity: "fail",
      evidence: `<meta property="og:url"> content is not a well-formed absolute URL: "${ogUrl}"`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
    return findings;
  }

  const canonNorm = normalizeForCompare(canonical);
  const ogNorm = normalizeForCompare(ogUrl);
  if (canonNorm !== ogNorm) {
    findings.push({
      checkId: "A4e_canonical_og_mismatch",
      layer: "technical",
      severity: "fail",
      evidence: `canonical "${canonical}" does not match og:url "${ogUrl}" after normalization — one of them is wrong`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
  }

  return findings;
}
