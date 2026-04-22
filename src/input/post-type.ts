import type { PostType } from "../types.js";

const FORMAT_MAP: Record<string, PostType> = {
  definition: "definitional",
  definitional: "definitional",
  glossary: "definitional",
  what_is: "definitional",
  "what-is": "definitional",
  how_to: "procedural",
  "how-to": "procedural",
  howto: "procedural",
  procedural: "procedural",
  tutorial: "procedural",
  guide: "pillar",
  pillar: "pillar",
  comparison: "comparison",
  vs: "comparison",
  alternatives: "comparison",
  listicle: "listicle",
  list: "listicle",
  best_of: "listicle",
  faq: "faq",
  paa: "faq",
  research: "research",
  study: "research",
  benchmark: "research",
  mechanism: "mechanism",
  explainer: "mechanism",
};

export function inferPostType(params: {
  rawFormat: string | null;
  topic: string | null;
  wordCount: number | null;
  schemaTypes: string[];
}): PostType {
  const { rawFormat, topic, wordCount, schemaTypes } = params;

  if (rawFormat) {
    const key = rawFormat.toLowerCase().replace(/\s+/g, "_");
    if (FORMAT_MAP[key]) return FORMAT_MAP[key];
  }

  if (schemaTypes.includes("HowTo")) return "procedural";
  if (schemaTypes.includes("DefinedTerm") || schemaTypes.includes("DefinedTermSet"))
    return "definitional";
  if (schemaTypes.includes("Dataset")) return "research";
  if (schemaTypes.includes("ItemList") && rawFormat?.toLowerCase().includes("best"))
    return "listicle";

  if (topic) {
    const t = topic.toLowerCase();
    if (/^what is\b|^what are\b/.test(t)) return "definitional";
    if (/^how to\b/.test(t)) return "procedural";
    if (/\bvs\.?\b|\balternatives?\b/.test(t)) return "comparison";
    if (/\bbest\b.*\b(tools?|apps?|platforms?)\b/.test(t)) return "listicle";
  }

  if (wordCount && wordCount >= 1900) return "pillar";

  return "general";
}

export interface PostTypeBand {
  minWords: number;
  targetWords: number;
  maxWords: number;
  requiredSchemaTypes: string[];
  recommendsTOC: boolean;
  expectsFAQ: boolean;
}

export const POST_TYPE_BANDS: Record<PostType, PostTypeBand> = {
  definitional: {
    minWords: 500,
    targetWords: 700,
    maxWords: 1000,
    requiredSchemaTypes: ["DefinedTerm"],
    recommendsTOC: false,
    expectsFAQ: true,
  },
  procedural: {
    minWords: 800,
    targetWords: 1200,
    maxWords: 1500,
    requiredSchemaTypes: ["HowTo"],
    recommendsTOC: false,
    expectsFAQ: false,
  },
  comparison: {
    minWords: 1200,
    targetWords: 1800,
    maxWords: 2500,
    requiredSchemaTypes: [],
    recommendsTOC: true,
    expectsFAQ: true,
  },
  pillar: {
    minWords: 1900,
    targetWords: 2500,
    maxWords: 4000,
    requiredSchemaTypes: [],
    recommendsTOC: true,
    expectsFAQ: true,
  },
  listicle: {
    minWords: 1500,
    targetWords: 2500,
    maxWords: 3500,
    requiredSchemaTypes: ["ItemList"],
    recommendsTOC: true,
    expectsFAQ: false,
  },
  faq: {
    minWords: 600,
    targetWords: 900,
    maxWords: 1200,
    requiredSchemaTypes: ["FAQPage"],
    recommendsTOC: false,
    expectsFAQ: true,
  },
  research: {
    minWords: 1500,
    targetWords: 2500,
    maxWords: 5000,
    requiredSchemaTypes: ["Dataset"],
    recommendsTOC: true,
    expectsFAQ: false,
  },
  mechanism: {
    minWords: 1200,
    targetWords: 1800,
    maxWords: 2500,
    requiredSchemaTypes: [],
    recommendsTOC: true,
    expectsFAQ: false,
  },
  general: {
    minWords: 600,
    targetWords: 1500,
    maxWords: 3000,
    requiredSchemaTypes: [],
    recommendsTOC: false,
    expectsFAQ: false,
  },
};
