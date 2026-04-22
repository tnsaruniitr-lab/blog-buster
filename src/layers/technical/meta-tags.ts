import { parse } from "node-html-parser";
import type { AuditInput, Finding } from "../../types.js";

function readMeta(input: AuditInput): Record<string, string> {
  if (Object.keys(input.metaTags).length) return input.metaTags;
  const root = parse(input.html);
  const out: Record<string, string> = {};
  const title = root.querySelector("title");
  if (title) out.title = title.text.trim();
  const metas = root.querySelectorAll("meta");
  for (const m of metas) {
    const name = m.getAttribute("name") ?? m.getAttribute("property");
    const content = m.getAttribute("content");
    if (name && content) out[name] = content;
  }
  return out;
}

export function auditMetaTags(input: AuditInput): Finding[] {
  const findings: Finding[] = [];
  const meta = readMeta(input);

  const title = meta.title ?? meta["og:title"];
  if (!title) {
    findings.push({
      checkId: "M_title_missing",
      layer: "technical",
      severity: "fail",
      evidence: "Missing <title> tag",
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
  } else if (title.length < 30 || title.length > 65) {
    findings.push({
      checkId: "M_title_length",
      layer: "technical",
      severity: "warn",
      evidence: `Title length ${title.length} (target 30–65): "${title}"`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "static",
    });
  }

  const desc = meta.description ?? meta["og:description"];
  if (!desc) {
    findings.push({
      checkId: "M_description_missing",
      layer: "technical",
      severity: "fail",
      evidence: "Missing meta description",
      sieveRules: [],
      sieveAps: [],
      truthBadge: "hard",
    });
  } else if (desc.length < 110 || desc.length > 170) {
    findings.push({
      checkId: "M_description_length",
      layer: "technical",
      severity: "warn",
      evidence: `Meta description length ${desc.length} (target 110–170)`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "static",
    });
  }

  const ogRequired = ["og:title", "og:description", "og:type", "og:url"];
  const missingOg = ogRequired.filter((k) => !meta[k]);
  if (missingOg.length) {
    findings.push({
      checkId: "M_og_incomplete",
      layer: "technical",
      severity: "warn",
      evidence: `Open Graph missing: ${missingOg.join(", ")}`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "static",
    });
  }

  if (!meta["twitter:card"]) {
    findings.push({
      checkId: "M_twitter_card_missing",
      layer: "technical",
      severity: "info",
      evidence: "No twitter:card meta tag",
      sieveRules: [],
      sieveAps: [],
      truthBadge: "static",
    });
  }

  return findings;
}
