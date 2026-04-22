import { parse } from "node-html-parser";
import type { AuditInput, Finding, Patch } from "../../types.js";
import {
  extractSchemaBlocks,
  flattenEntities,
  entityTypes,
  visibleText,
} from "../../shared-lib/validators.js";

type JsonLdEntity = Record<string, unknown>;

function readHeadField(html: string, selector: string, attr: string): string | null {
  const root = parse(html);
  const n = root.querySelector(selector);
  if (!n) return null;
  const v = n.getAttribute(attr) ?? n.text ?? "";
  return v ? v.trim() : null;
}

function currentHeadline(input: AuditInput): string {
  const title = readHeadField(input.html, "title", "text");
  if (title) return title;
  const h1 = parse(input.html).querySelector("h1");
  if (h1) return h1.text.trim();
  return input.topic ?? input.primaryKeyword ?? input.slug;
}

function currentDescription(input: AuditInput): string {
  const meta = readHeadField(input.html, 'meta[name="description"]', "content");
  if (meta) return meta;
  const og = readHeadField(input.html, 'meta[property="og:description"]', "content");
  if (og) return og;
  const body = visibleText(input.articleBodyHtml || input.html);
  return body.slice(0, 160);
}

function currentImage(input: AuditInput): string | null {
  const og = readHeadField(input.html, 'meta[property="og:image"]', "content");
  if (og) return og;
  const img = parse(input.html).querySelector("article img, main img, img");
  if (img) return img.getAttribute("src") ?? null;
  return null;
}

function canonicalUrl(input: AuditInput): string | null {
  const canonical = readHeadField(input.html, 'link[rel="canonical"]', "href");
  if (canonical) return canonical;
  const og = readHeadField(input.html, 'meta[property="og:url"]', "content");
  return og;
}

function findPerson(entities: JsonLdEntity[]): JsonLdEntity | null {
  return entities.find((e) => entityTypes(e).includes("Person")) ?? null;
}

function findOrganization(entities: JsonLdEntity[]): JsonLdEntity | null {
  return (
    entities.find((e) => entityTypes(e).includes("Organization")) ?? null
  );
}

function buildAuthor(input: AuditInput, person: JsonLdEntity | null): JsonLdEntity {
  if (person) return person;
  // If no Person entity exists, leave a minimal stub. insert_missing
  // (shakes-peer side) will replace this with real author data.
  return {
    "@type": "Person",
    name: input.brand || "Editorial Team",
  };
}

function buildBlogPosting(input: AuditInput, existing: JsonLdEntity[]): JsonLdEntity {
  const person = findPerson(existing);
  const org = findOrganization(existing);
  const entity: JsonLdEntity = {
    "@type": "BlogPosting",
    headline: currentHeadline(input),
    description: currentDescription(input),
    author: buildAuthor(input, person),
    datePublished: new Date().toISOString().slice(0, 10),
    dateModified: new Date().toISOString().slice(0, 10),
  };
  const image = currentImage(input);
  if (image) entity.image = image;
  if (org) entity.publisher = org;
  const url = canonicalUrl(input);
  if (url) entity.mainEntityOfPage = url;
  return entity;
}

function parseMissingFields(evidence: string): string[] {
  // e.g. "BlogPosting missing Google-required: author, image"
  const m = evidence.match(/:\s*(.+)$/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SchemaPlanOutput {
  patches: Patch[];
  cost: number;
}

export function planSchemaPatches(
  input: AuditInput,
  findings: Finding[],
): SchemaPlanOutput {
  const blocks = input.schemas.length ? input.schemas : extractSchemaBlocks(input.html);
  const entities = flattenEntities(blocks);
  const patches: Patch[] = [];

  for (const f of findings) {
    // Case 1: missing Article/BlogPosting entity altogether -> insert a skeleton
    if (f.checkId === "D_no_article_entity") {
      const entity = buildBlogPosting(input, entities);
      patches.push({
        type: "insert_schema",
        target: "add:BlogPosting",
        before: "",
        after: JSON.stringify(entity),
        rationale:
          "Insert BlogPosting entity with headline/author/datePublished/description derived from page context",
      });
      continue;
    }

    // Case 2: BlogPosting/Article present but missing Google-required fields
    if (
      f.checkId === "D_BlogPosting_missing_google_required" ||
      f.checkId === "D_Article_missing_google_required" ||
      f.checkId === "D_NewsArticle_missing_google_required"
    ) {
      const parentType = f.checkId.split("_")[1];
      const missing = parseMissingFields(f.evidence);
      for (const field of missing) {
        let value: unknown = null;
        if (field === "author") {
          value = buildAuthor(input, findPerson(entities));
        } else if (field === "image") {
          value = currentImage(input);
        } else if (field === "headline") {
          value = currentHeadline(input);
        } else if (field === "datePublished") {
          value = new Date().toISOString().slice(0, 10);
        }
        if (value === null) continue;
        patches.push({
          type: "insert_schema",
          target: `${parentType}.${field}`,
          before: "undefined",
          after: JSON.stringify(value),
          rationale: `Set ${parentType}.${field} (Google-required; derived from page context)`,
        });
      }
      continue;
    }

    // Case 3: missing recommended fields on BlogPosting/Article/WebPage
    if (
      f.checkId === "D_BlogPosting_missing_recommended" ||
      f.checkId === "D_Article_missing_recommended" ||
      f.checkId === "D_NewsArticle_missing_recommended" ||
      f.checkId === "D_WebPage_missing_recommended"
    ) {
      const parentType = f.checkId.split("_")[1];
      const missing = parseMissingFields(f.evidence);
      for (const field of missing) {
        if (field === "dateModified") {
          patches.push({
            type: "insert_schema",
            target: `${parentType}.dateModified`,
            before: "undefined",
            after: JSON.stringify(new Date().toISOString().slice(0, 10)),
            rationale: `Set ${parentType}.dateModified (recommended freshness signal; ${f.checkId})`,
          });
        } else if (field === "description") {
          patches.push({
            type: "insert_schema",
            target: `${parentType}.description`,
            before: "undefined",
            after: JSON.stringify(currentDescription(input)),
            rationale: `Set ${parentType}.description (${f.checkId})`,
          });
        } else if (field === "mainEntityOfPage") {
          const url = canonicalUrl(input);
          if (!url) continue;
          patches.push({
            type: "insert_schema",
            target: `${parentType}.mainEntityOfPage`,
            before: "undefined",
            after: JSON.stringify(url),
            rationale: `Set ${parentType}.mainEntityOfPage to canonical URL (${f.checkId})`,
          });
        } else if (field === "inLanguage") {
          patches.push({
            type: "insert_schema",
            target: `${parentType}.inLanguage`,
            before: "undefined",
            after: JSON.stringify("en-US"),
            rationale: `Set ${parentType}.inLanguage to en-US (${f.checkId})`,
          });
        } else if (field === "primaryImageOfPage") {
          const image = currentImage(input);
          if (!image) continue;
          patches.push({
            type: "insert_schema",
            target: `${parentType}.primaryImageOfPage`,
            before: "undefined",
            after: JSON.stringify({ "@type": "ImageObject", url: image }),
            rationale: `Set ${parentType}.primaryImageOfPage from og:image (${f.checkId})`,
          });
        }
      }
      continue;
    }

    // Case 4: WebPage missing required: name
    if (f.checkId === "D_WebPage_missing_required") {
      const missing = parseMissingFields(f.evidence);
      if (missing.includes("name")) {
        patches.push({
          type: "insert_schema",
          target: "WebPage.name",
          before: "undefined",
          after: JSON.stringify(currentHeadline(input)),
          rationale: "Set WebPage.name from page title",
        });
      }
      continue;
    }

    // Case 5: Organization missing recommended -> description is the cheap one
    if (f.checkId === "D_Organization_missing_recommended") {
      const missing = parseMissingFields(f.evidence);
      if (missing.includes("description")) {
        patches.push({
          type: "insert_schema",
          target: "Organization.description",
          before: "undefined",
          after: JSON.stringify(
            `${input.brand} — content and insights`,
          ),
          rationale: "Set Organization.description (placeholder; brand-owned edit recommended)",
        });
      }
      continue;
    }
  }

  return { patches, cost: 0 };
}
