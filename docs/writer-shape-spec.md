# Writer Shape Spec — what shakes-peer must emit to stay in sync with blog-buster

**Audience:** shakes-peer team (`serp-analyzer/src/blog/writer.ts` and synthesizers)
**Writer:** blog-buster
**Purpose:** give writer-side additions a stable shape contract so when I add detectors for them later, they pass on v1 without coordination rework.
**Status:** normative. If you emit different shapes, my future detectors won't see your work.
**Last updated:** 2026-04-23

## Why this exists

The writer team correctly observed: *"blog-buster's rule catalog is a subset of what matters for real-world ranking. Building capabilities the auditor doesn't check is the correct move — but if the writer picks shapes freely and the auditor picks shapes later, the two will diverge."*

This document locks the shapes **in advance**, so the writer can ship today and blog-buster's presence-check detector can ship later without rework. Writer sets the quality of the output. Auditor verifies presence. Neither caps the other.

---

## Section 1 — Shapes the writer should emit NOW (blog-buster detectors coming later)

### 1.1 Entity interconnection (`@id` resolution)

Every entity in `@graph` MUST have a stable `@id`. Every cross-reference between entities MUST use `{ "@id": "..." }` referring to an actual `@id` in the same graph.

**Canonical `@id` patterns** (not required, but strongly recommended for consistency):

| Entity | `@id` pattern |
|---|---|
| BlogPosting/Article | `{canonical_url}#article` |
| Author Person | `{brand_url}/authors/{author_slug}#person` (or stable UUID URI) |
| Organization | `{brand_url}/#organization` |
| WebPage | `{canonical_url}#webpage` |
| WebSite | `{brand_url}/#website` |
| BreadcrumbList | `{canonical_url}#breadcrumbs` |
| FAQPage | `{canonical_url}#faq` |
| ImageObject (hero) | `{canonical_url}#hero-image` |

**Cross-reference shape — use this form:**
```json
{
  "@type": "BlogPosting",
  "@id": "https://answermonk.ai/blog/what-is-aeo#article",
  "author":    { "@id": "https://answermonk.ai/authors/jake-stein#person" },
  "publisher": { "@id": "https://answermonk.ai/#organization" },
  "mainEntityOfPage": { "@id": "https://answermonk.ai/blog/what-is-aeo#webpage" },
  "isPartOf":  { "@id": "https://answermonk.ai/#website" }
}
```

**Do NOT:**
- Inline the full entity at the referring site (duplicates; no cross-page reusability)
- Use a reference to an `@id` that isn't declared elsewhere in the same `@graph`
- Use unstable `@id` values (random UUIDs regenerated per run break cache consistency)

**Blog-buster detector (coming v0.1.6):**
- `D_entity_id_unresolved` — a `{"@id": ref}` reference found in an entity field, but no entity with that `@id` exists in the graph
- `D_entity_missing_id_on_referenced` — an entity is referenced by another entity but has no `@id` of its own

### 1.2 Speakable schema

Added to the BlogPosting/Article entity. Points at CSS selectors that voice assistants can read aloud as the "spoken summary" of the page.

**Required shape:**
```json
"speakable": {
  "@type": "SpeakableSpecification",
  "cssSelector": ["[data-tldr]", ".quick-answer", "h1"]
}
```

**Rules:**
- At least one selector
- Selectors MUST resolve in the rendered HTML (point at real elements)
- Prefer `[data-tldr]` as the first selector (aligns with TL;DR block contract)
- `h1` as a fallback is acceptable
- Can also use `xpath` form: `"xpath": ["/html/body//h1"]` — but `cssSelector` is preferred

**Anti-pattern:**
- Emit speakable referencing selectors that don't exist (detector will fail loudly once it verifies selector resolution)
- Set selector to `"body"` (too broad — defeats the spoken-summary purpose)

**Blog-buster detector (coming v0.1.7 after writer lands it):**
- `D_speakable_missing` — no `speakable` on BlogPosting
- `D_speakable_empty_selectors` — `cssSelector` is empty or absent
- `D_speakable_unresolved_selectors` — selectors don't match any DOM element (HTML verification)

### 1.3 Robots meta with `max-snippet:-1`

Every published post MUST emit:
```html
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
```

Required directives (both values):
- `index` + `follow` (required for publication — post must not be noindex/nofollow)
- `max-snippet:-1` (allows Google to show arbitrary-length snippet — critical for AI Overview inclusion)

Recommended additional directives:
- `max-image-preview:large` (better SERP image rendering)
- `max-video-preview:-1` (if the post has video)

**Anti-patterns (already detected, critical):**
- `noindex` or `nofollow` on a published post → `A5_robots_meta_indexing` fires as critical BLOCK

**Blog-buster detector (coming v0.1.7):**
- `M_robots_missing_max_snippet` — robots meta exists but lacks `max-snippet:-1` or `max-snippet:<number>` ≥ 160

### 1.4 Full-ISO timestamps for `datePublished` + `dateModified`

Both JSON-LD fields MUST use full ISO 8601 format with seconds and timezone offset (or `Z`):

```json
"datePublished": "2026-04-23T10:30:00+05:30",
"dateModified":  "2026-04-23T14:45:12Z"
```

**Detector regex:**
```
^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$
```

**Anti-patterns:**
- `"2026-04-23"` (date-only — date arithmetic ambiguous)
- `"2026-04-23T10:30"` (hours/minutes but no seconds — passes today's loose check, fails tightened regex)
- `"2026-04-23T10:30:00"` (no timezone — ambiguous across regions)

**Blog-buster detector (tightening in v0.1.6):**
- `D_datemodified_missing_time` — existing check, regex tightened to require seconds + timezone
- Same for `datePublished`

### 1.5 Image `alt` enforcement

Every `<img>` inside `<article>` / `<main>` / the post body MUST have a non-empty `alt` attribute. Decorative images MUST use explicit `alt=""` (not omitted).

**Shapes:**
```html
<!-- Required alt, descriptive -->
<img src="hero.png" alt="Comparison chart: AEO vs SEO citation sources across 5 engines">

<!-- Decorative-only, explicit empty alt -->
<img src="divider.svg" alt="" aria-hidden="true">
```

**Alt-text quality rules (advisory, not enforced yet):**
- 5–125 characters
- Describe the image content, not its layout role
- Avoid "image of" / "picture showing" (redundant)

**Blog-buster detector (coming v0.1.7):**
- `D_img_alt_missing` — existing `T_img_alt_missing` (already fires). Upgrading from warn to fail once writer commits.
- `D_img_alt_empty_non_decorative` — alt="" but no `aria-hidden="true"` (inconsistent)

### 1.6 `llms.txt` at brand root

**This is not a per-post concern. It's a per-brand, per-deploy concern.**

The writer emits HTML for individual posts. `llms.txt` is a single file at `{brand_url}/llms.txt` describing the site's content policy to LLM crawlers. It belongs in Brandsmith's deploy output or the brand's static-site publish pipeline, not in shakes-peer's per-post rendering.

**Blog-buster will not check this per-post.** If the writer team wants visibility, add a one-time brand-level validator in Brandsmith that fetches `{brand_url}/llms.txt` and verifies format.

---

## Section 2 — Shapes the writer should emit for existing detectors (recap from coherence-brief)

Repeating for completeness. Full details in `docs/shakespeer-coherence-brief.md`.

| Element | Canonical shape |
|---|---|
| TL;DR | `<p data-tldr>TL;DR: …</p>` |
| Editorial stance | `<aside class="editorial-stance" data-editorial="true">…</aside>` |
| Author bio | `<section class="author-bio" itemscope itemtype="https://schema.org/Person">…</section>` |
| Last updated | `<p class="last-updated">Last updated: <time datetime="ISO">…</time></p>` |
| FAQ pairs | `<h2>/<h3>/<h4>?` followed by `<p>/<ul>/<ol>`, OR `<details><summary>?</summary>A</details>` |
| DefinedTerm | JSON-LD entity with `@type`, `name`, `description`, `inDefinedTermSet` |
| BlogPosting | required: headline, datePublished, author, image; recommended: dateModified, description, mainEntityOfPage, publisher, speakable (§1.2) |

---

## Section 3 — Shapes for writer-owned conventions (no detector planned)

These are writer-side quality choices. Blog-buster will NOT audit them. Ship the best version you can; no auditor feedback will guide you.

### 3.1 Internal linking
- Minimum 3 internal links per post (writer's rule, not auditor's)
- Wikipedia-style: first mention of a concept with a dedicated page → link it
- Related-posts footer section with 3-5 contextual links

### 3.2 Table of contents
- For posts > 1500 words: `<nav aria-label="Table of contents">…</nav>` near top
- Blog-buster has `S_toc_missing` — partial coverage, only for post-type pillar/comparison/listicle/research/mechanism
- Writer can emit for definitional/faq/procedural/general too if post length warrants

### 3.3 Per-section answer boxes
- Optional writer convention: `<div data-aeo-answer="<question>"><p>Answer: …</p></div>`
- If the writer adopts this shape, add to §1 and blog-buster will detect presence in a future version

### 3.4 Publisher logo metadata
- `Organization.logo` in JSON-LD should be an `ImageObject` with `width` + `height`
- Writer has dimensions at generation time (from Brandsmith config)
- Shape: `"logo": { "@type": "ImageObject", "url": "...", "width": 600, "height": 60 }`
- Blog-buster checks presence of `logo` (already) but not dimensions

### 3.5 BlogPosting extended fields
- `wordCount`: integer, counted after final render
- `articleSection`: string, typically the category ("Group Trip Planning", etc.)
- `keywords`: array of strings or single comma-separated string
- None enforced by blog-buster — but emit them for downstream consumers (RSS parsers, content platforms, LLM ingestion tools)

---

## Section 4 — The shape-contract discipline

Three rules for both teams:

1. **Shape first, code second.** When either side wants to add a capability, the shape goes in this doc BEFORE implementation. Prevents the TL;DR aside-vs-p divergence we hit in the first round.

2. **Presence check before quality check.** Blog-buster's detectors should start as presence checks (does the shape exist?), graduate to shape checks (is the shape valid?), then quality checks (is the content good?) only if there's signal. Writer-side quality dwarfs auditor-side quality judgment.

3. **One source of truth per shape.** This doc. If the writer team prefers a different shape, amend this doc first, then change the code. Blog-buster will follow the amended spec.

---

## Section 5 — What happens when the writer ships an Option A capability

1. Writer builds (e.g.) speakable schema emission in `writer.ts`
2. Writer team commits a PR touching this doc's §1.2 to reflect the exact shape emitted
3. Blog-buster team reads the update, adds a presence-check detector in a follow-up release (typically within a week)
4. Detector ships as a `warn`-severity finding initially (giving the writer team time to validate coverage in the wild)
5. After 20+ posts audited cleanly with the new detector, severity can be upgraded to `fail` or `critical` as appropriate

This cadence keeps both sides honest. Writer can innovate freely. Auditor can't be surprised by a shape it didn't expect.

---

## Section 6 — Current sync state

| Capability | Writer emits? | Blog-buster detects? | Next action |
|---|---|---|---|
| `@id` entity interconnection | Partial (some entities, some refs inline) | No (v0.1.6 adds it) | Writer: enforce at every entity. Auditor: v0.1.6 presence check |
| Speakable schema | No | No | Writer: Option A. Auditor: presence check after writer ships |
| Robots `max-snippet:-1` | No | No | Writer: Option A. Auditor: presence check after writer ships |
| Full-ISO timestamps | Partial | Partial (loose regex, tightening in v0.1.6) | Writer: emit full ISO. Auditor: regex tightened |
| Image alt text | Partial | Partial (T_img_alt_missing, warn) | Writer: enforce non-empty. Auditor: severity upgrade after writer ships |
| `llms.txt` | No | Not scoped (brand-level) | Not a per-post concern |
| Schema validity | Trusting generator | No (v0.1.6 adds it) | Writer: keep emitting valid. Auditor: hard-fail on parse errors |
| Heading skip | Trusting generator | Yes (already fires) | No action — already in sync |
| Canonical ↔ og:url match | Trusting generator | No (v0.1.6 adds it) | Writer: keep them in sync. Auditor: checks internal consistency |

---

## Section 7 — Where to find this doc

- `blog-buster/docs/writer-shape-spec.md` — this file (normative)
- `blog-buster/docs/shakespeer-coherence-brief.md` — file:line fixes for shape mismatches currently in flight
- `serp-analyzer/docs/handshake-contract.md §7a` — normative markup shapes already locked

If there's a conflict between the three: this doc wins for writer-side additions, the handshake contract wins for integration protocol, coherence brief is a point-in-time snapshot.

Questions / disagreements → update this doc directly (both teams have write access to both repos) or raise as an issue on `github.com/tnsaruniitr-lab/blog-buster`.
