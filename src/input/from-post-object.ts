import type { AuditInput } from "../types.js";
import { inferPostType } from "./post-type.js";
import { flattenEntities, entityTypes } from "../shared-lib/validators.js";

export interface BloggerPost {
  slug: string;
  brand: { name: string; website?: string };
  html: string;
  articleBodyHtml?: string;
  jsonLdSchemas?: unknown[];
  metaTags?: Record<string, unknown>;
  topic?: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  format?: string;
  wordCount?: number;
}

function flattenMetaTags(meta: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      out[k] = v;
    } else if (typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (typeof v2 === "string") out[`${k}:${k2}`] = v2;
      }
    }
  }
  if (out["og:description"] && !out.description) {
    out.description = out["og:description"];
  }
  return out;
}

function unwrapSchemas(raw: unknown[]): unknown[] {
  return raw.map((s) => {
    const obj = s as Record<string, unknown>;
    if (obj && typeof obj === "object" && "schema" in obj && !("@type" in obj)) {
      return obj.schema;
    }
    return s;
  });
}

export function loadFromPostObject(post: BloggerPost): AuditInput {
  const schemas = post.jsonLdSchemas ? unwrapSchemas(post.jsonLdSchemas) : [];
  const metaTags = post.metaTags ? flattenMetaTags(post.metaTags) : {};

  const entities = flattenEntities(schemas);
  const schemaTypes = entities.flatMap(entityTypes);

  const postType = inferPostType({
    rawFormat: post.format ?? null,
    topic: post.topic ?? null,
    wordCount: post.wordCount ?? null,
    schemaTypes,
  });

  return {
    slug: post.slug,
    brand: post.brand.name,
    sourceDir: null,
    html: post.html,
    articleBodyHtml: post.articleBodyHtml ?? post.html,
    schemas,
    metaTags,
    metadata: {
      brand: post.brand,
      post: {
        topic: post.topic,
        slug: post.slug,
        format: post.format,
        primary_keyword: post.primaryKeyword,
        secondary_keywords: post.secondaryKeywords,
      },
      quality: { word_count: post.wordCount },
    },
    primaryKeyword: post.primaryKeyword ?? null,
    secondaryKeywords: post.secondaryKeywords ?? [],
    topic: post.topic ?? null,
    wordCount: post.wordCount ?? null,
    postType,
    rawFormat: post.format ?? null,
  };
}
