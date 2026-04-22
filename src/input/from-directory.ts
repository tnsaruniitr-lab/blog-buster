import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { AuditInput } from "../types.js";
import { inferPostType } from "./post-type.js";
import { flattenEntities, entityTypes } from "../shared-lib/validators.js";

export function loadFromDirectory(dir: string): AuditInput {
  const metaPath = join(dir, "metadata.json");
  if (!existsSync(metaPath)) {
    throw new Error(`metadata.json not found in ${dir}`);
  }
  const metadata = JSON.parse(readFileSync(metaPath, "utf-8")) as {
    brand?: { name?: string };
    post?: {
      topic?: string;
      slug?: string;
      format?: string;
      primary_keyword?: string;
      secondary_keywords?: string[];
    };
    quality?: { word_count?: number };
  };

  const html = readFileSync(join(dir, "full-page.html"), "utf-8");
  const articleBodyHtml = existsSync(join(dir, "article-body.html"))
    ? readFileSync(join(dir, "article-body.html"), "utf-8")
    : html;

  const rawSchemas = existsSync(join(dir, "schemas.json"))
    ? (JSON.parse(readFileSync(join(dir, "schemas.json"), "utf-8")) as unknown[])
    : [];
  const schemas = rawSchemas.map((s) => {
    const obj = s as Record<string, unknown>;
    if (obj && typeof obj === "object" && "schema" in obj && !("@type" in obj)) {
      return obj.schema;
    }
    return s;
  });

  const metaRaw = existsSync(join(dir, "meta-tags.json"))
    ? (JSON.parse(readFileSync(join(dir, "meta-tags.json"), "utf-8")) as Record<string, unknown>)
    : {};
  const metaTags: Record<string, string> = {};
  for (const [k, v] of Object.entries(metaRaw)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      metaTags[k] = v;
    } else if (typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (typeof v2 === "string") metaTags[`${k}:${k2}`] = v2;
      }
    }
  }
  if (metaTags["og:description"] && !metaTags.description) {
    metaTags.description = metaTags["og:description"];
  }

  const entities = flattenEntities(schemas);
  const schemaTypes = entities.flatMap(entityTypes);
  const rawFormat = metadata.post?.format ?? null;
  const topic = metadata.post?.topic ?? null;
  const wordCount = metadata.quality?.word_count ?? null;
  const postType = inferPostType({ rawFormat, topic, wordCount, schemaTypes });

  return {
    slug: metadata.post?.slug ?? basename(dir),
    brand: metadata.brand?.name ?? "unknown",
    sourceDir: dir,
    html,
    articleBodyHtml,
    schemas,
    metaTags,
    metadata: metadata as Record<string, unknown>,
    primaryKeyword: metadata.post?.primary_keyword ?? null,
    secondaryKeywords: metadata.post?.secondary_keywords ?? [],
    topic,
    wordCount,
    postType,
    rawFormat,
  };
}
