export type MetricType = "boolean" | "count" | "ratio" | "enum";

export interface CriticalMetric {
  checkId: string;
  label: string;
  category: "eeat" | "schema" | "indexability" | "structure" | "content";
  metricType: MetricType;
  target: string;
  weight: number;
  autoFixable: boolean;
  fixHint: string;
  source: string;
}

export const CRITICAL_METRICS: Record<string, CriticalMetric> = {
  E_author_person_missing: {
    checkId: "E_author_person_missing",
    label: "Author Person entity in JSON-LD",
    category: "eeat",
    metricType: "boolean",
    target: "Person entity present with @type=Person",
    weight: 20,
    autoFixable: false,
    fixHint: "Add a Person entity to the JSON-LD graph and set it as the Article's author",
    source: "R-060 (Advisor + Ahrefs Turn 7)",
  },
  E_author_name_missing: {
    checkId: "E_author_name_missing",
    label: "Author name populated",
    category: "eeat",
    metricType: "boolean",
    target: "Person.name is a non-empty string",
    weight: 15,
    autoFixable: false,
    fixHint: "Populate Person.name with a real human name",
    source: "R-060",
  },
  E_author_sameas_missing: {
    checkId: "E_author_sameas_missing",
    label: "Author sameAs URLs",
    category: "eeat",
    metricType: "count",
    target: "Person.sameAs has ≥2 profile URLs incl. LinkedIn",
    weight: 20,
    autoFixable: false,
    fixHint: "Add Person.sameAs: [linkedin_url, twitter_or_site_url]. LinkedIn is the key verifier",
    source: "R-060 + R-061",
  },
  E_human_signals_bundle_incomplete: {
    checkId: "E_human_signals_bundle_incomplete",
    label: "4 human signals bundle",
    category: "eeat",
    metricType: "count",
    target: "All 4 signals present: author+LinkedIn, first-party data, original visual, 3+ outbound citations",
    weight: 25,
    autoFixable: false,
    fixHint: "Fix the 2-3 signals that are missing; each roughly maps to a separate edit",
    source: "R-160 (Ahrefs Turn 7, Profound deindex case)",
  },
  A4_canonical_tag: {
    checkId: "A4_canonical_tag",
    label: "Canonical link tag",
    category: "indexability",
    metricType: "boolean",
    target: '<link rel="canonical" href="..."> present with non-empty href',
    weight: 15,
    autoFixable: true,
    fixHint: "Add canonical tag in <head> pointing to the post's absolute URL",
    source: "R-144 (Standard SEO)",
  },
  A5_robots_meta_indexing: {
    checkId: "A5_robots_meta_indexing",
    label: "Robots meta not noindex",
    category: "indexability",
    metricType: "boolean",
    target: 'meta[name=robots] content does NOT contain "noindex"',
    weight: 30,
    autoFixable: true,
    fixHint: 'Remove "noindex" from robots meta, or remove the meta tag entirely',
    source: "Sieve brain R:1166 / Ahrefs",
  },
  A9_viewport_meta: {
    checkId: "A9_viewport_meta",
    label: "Viewport meta present",
    category: "indexability",
    metricType: "boolean",
    target: 'meta[name=viewport] content has width=device-width',
    weight: 10,
    autoFixable: true,
    fixHint: 'Add <meta name="viewport" content="width=device-width,initial-scale=1">',
    source: "Standard mobile SEO",
  },
  D_no_schema_blocks: {
    checkId: "D_no_schema_blocks",
    label: "JSON-LD schema present",
    category: "schema",
    metricType: "count",
    target: "≥1 <script type='application/ld+json'> block with parseable JSON",
    weight: 25,
    autoFixable: true,
    fixHint: "Emit at least a BlogPosting schema block with headline, datePublished, author, image",
    source: "R-030",
  },
  D_no_article_entity: {
    checkId: "D_no_article_entity",
    label: "Article/BlogPosting entity",
    category: "schema",
    metricType: "boolean",
    target: "JSON-LD contains Article, BlogPosting, or NewsArticle entity",
    weight: 20,
    autoFixable: true,
    fixHint: "Add a BlogPosting entity (not just WebPage or Organization)",
    source: "R-030",
  },
  "D_BlogPosting_missing_google_required": {
    checkId: "D_BlogPosting_missing_google_required",
    label: "BlogPosting Google-required fields",
    category: "schema",
    metricType: "count",
    target: "author and image fields present on BlogPosting",
    weight: 15,
    autoFixable: true,
    fixHint: "Populate BlogPosting.author (Person) and BlogPosting.image (hero URL)",
    source: "R-030 (Google Search Central)",
  },
  "D_Article_missing_google_required": {
    checkId: "D_Article_missing_google_required",
    label: "Article Google-required fields",
    category: "schema",
    metricType: "count",
    target: "author and image fields present on Article",
    weight: 15,
    autoFixable: true,
    fixHint: "Populate Article.author (Person) and Article.image (hero URL)",
    source: "R-030 (Google Search Central)",
  },
};

export function metricFor(checkId: string): CriticalMetric | null {
  return CRITICAL_METRICS[checkId] ?? null;
}
