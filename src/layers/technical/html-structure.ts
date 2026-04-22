import { parse } from "node-html-parser";
import type { AuditInput, Finding } from "../../types.js";
import { brainFor } from "../../shared-lib/registry.js";

export function auditHtmlStructure(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const root = parse(input.html);

  const h1s = root.querySelectorAll("h1");
  if (h1s.length === 0) {
    findings.push({
      checkId: "T_h1_missing",
      layer: "technical",
      severity: "fail",
      evidence: "No <h1> tag found",
      sieveRules: brainFor("T_h1_missing").rules,
      sieveAps: brainFor("T_h1_missing").aps,
      truthBadge: "hard",
    });
  } else if (h1s.length > 1) {
    findings.push({
      checkId: "T_h1_multiple",
      layer: "technical",
      severity: "warn",
      evidence: `${h1s.length} <h1> tags found; should be exactly 1`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
  }

  const headings = root.querySelectorAll("h1, h2, h3, h4, h5, h6");
  let prev = 0;
  for (const h of headings) {
    const level = Number(h.tagName.toLowerCase().slice(1));
    if (prev > 0 && level > prev + 1) {
      findings.push({
        checkId: "T_heading_hierarchy_gap",
        layer: "technical",
        severity: "warn",
        evidence: `Heading jumps from H${prev} to H${level}: "${h.text.slice(0, 80)}"`,
        sieveRules: [],
        sieveAps: [],
        truthBadge: "hard",
      });
      break;
    }
    prev = level;
  }

  const imgs = root.querySelectorAll("img");
  const missingAlt = imgs.filter((img) => !img.getAttribute("alt"));
  if (imgs.length > 0 && missingAlt.length > 0) {
    findings.push({
      checkId: "T_img_alt_missing",
      layer: "technical",
      severity: "warn",
      evidence: `${missingAlt.length} of ${imgs.length} images missing alt text`,
      sieveRules: brainFor("T_img_alt_missing").rules,
      sieveAps: brainFor("T_img_alt_missing").aps,
      truthBadge: "hard",
    });
  }

  const canonical = root.querySelector('link[rel="canonical"]');
  if (!canonical?.getAttribute("href")) {
    findings.push({
      checkId: "A4_canonical_tag",
      layer: "technical",
      severity: "critical",
      evidence: "Missing or empty canonical link tag",
      sieveRules: brainFor("A4_canonical_tag").rules,
      sieveAps: brainFor("A4_canonical_tag").aps,
      truthBadge: "hard",
    });
  }

  const viewport = root.querySelector('meta[name="viewport"]');
  if (!viewport?.getAttribute("content")) {
    findings.push({
      checkId: "A9_viewport_meta",
      layer: "technical",
      severity: "fail",
      evidence: "Missing viewport meta tag",
      sieveRules: brainFor("A9_viewport_meta").rules,
      sieveAps: brainFor("A9_viewport_meta").aps,
      truthBadge: "hard",
    });
  }

  const robots = root.querySelector('meta[name="robots"]');
  const robotsContent = robots?.getAttribute("content")?.toLowerCase() ?? "";
  if (robotsContent.includes("noindex")) {
    findings.push({
      checkId: "A5_robots_meta_indexing",
      layer: "technical",
      severity: "critical",
      evidence: `robots meta contains noindex: "${robotsContent}"`,
      sieveRules: brainFor("A5_robots_meta_indexing").rules,
      sieveAps: brainFor("A5_robots_meta_indexing").aps,
      truthBadge: "hard",
    });
  }

  const internalLinks = root.querySelectorAll('a[href^="/"], a[href^="#"]');
  if (internalLinks.length < 2) {
    findings.push({
      checkId: "T_internal_links_sparse",
      layer: "technical",
      severity: "warn",
      evidence: `Only ${internalLinks.length} internal links`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "heuristic",
    });
  }

  return findings;
}
