# Coherence Brief — shakes-peer ↔ blog-buster

**Audience:** shakes-peer team (the writer project at `serp-analyzer/`)
**Writer:** blog-buster (the auditor)
**Last updated:** 2026-04-23
**Grounded in:** code inspection of serp-analyzer @ main + blog-buster @ 9da1ec6

## Why this doc exists

Two projects, two rewriters, one shared goal. Today's split is muddled:

| Concern | Today | Target |
|---|---|---|
| Detection | blog-buster | blog-buster |
| Sentence rewrites | blog-buster inner loop | shakes-peer |
| Schema/meta field edits | blog-buster inner loop | shakes-peer |
| Content synthesis (TL;DR, FAQ rebuild, DefinedTerm, author bio) | shakes-peer (synthesizers) | shakes-peer |
| Document-wide style (em-dashes, tricolons, passives) | nobody | blog-buster detects → shakes-peer applies |
| Version lineage + round control | shakes-peer `audit-loop.ts` | shakes-peer |

The target is clean: **shakes-peer writes and rewrites. Blog-buster detects and proposes.** This brief walks that transition in two phases — a short-term fix-what's-in-the-way pass, and a longer-term v0.2.0 architectural move.

---

## Short-term fixes (do these now — Category A/B from builder's trace)

### A1. TL;DR markup shape

**File:** `serp-analyzer/src/handlers/synthesize-content.ts:122`

Today:
```ts
const block = `<aside class="tldr" data-generated="synthesize-content"><strong>TL;DR:</strong> ${escapeHtml(tldr)}</aside>`;
```

Blog-buster's detector (`blog-buster/src/layers/technical/advanced-structure.ts:83-99`) looks for `<p data-tldr>` OR a paragraph whose text starts with `/^tl;?dr[:\s]/i`. An `<aside class="tldr">` satisfies your local presence check but not mine — so re-audit re-flags `S_tldr_missing` on v2/v3 as "still_present."

**Recommended change:**
```ts
const block = `<p data-tldr data-generated="synthesize-content"><strong>TL;DR:</strong> ${escapeHtml(tldr)}</p>`;
```

Also update the pre-check at line 73 so you don't double-insert:
```ts
if (/<p[^>]*data-tldr/i.test(state.html) || /<(aside|section|div)[^>]*class=["'][^"']*\btldr\b/i.test(state.html)) { ... skip }
```

Net effect: `S_tldr_missing` moves from `still_present` → `fixed` on v2.

### A2. Organization schema — `sameAs` + `contactPoint`

**File:** `serp-analyzer/src/handlers/synthesize-content.ts:378-386` (`sameAsUrlsFrom`) plus the Organization synthesizer body

Today: `sameAsUrlsFrom` returns `undefined` if the brand has no `twitter_url`/`linkedin_url`/`github_url`/`crunchbase_url`. Organization then lacks `sameAs`, and my detector flags `D_Organization_missing_recommended: logo, contactPoint, sameAs`.

**Recommended change (two parts):**

1. **Always emit a `sameAs` array, even if empty — but log when it's empty.** Empty array is a better signal than missing field for machine readers. Populate from brand config; if empty, surface as an open item to pressure callers to fill it in their brief.
2. **Always emit `contactPoint`.** A skeleton is fine: `{ "@type": "ContactPoint", "contactType": "customer support", "url": brand.website + "/contact" }`. The brand can override in their config; don't leave it unset.

### A3. WebPage missing `dateModified` + `primaryImageOfPage`

**File:** `serp-analyzer/src/handlers/synthesize-content.ts:352-360`

Today:
```ts
const webPage: Record<string, unknown> = {
  "@type": "WebPage",
  "@id": `${url}#webpage`,
  url,
  name: title,
  description: description || undefined,
  isPartOf: host ? { "@type": "WebSite", url: host, name: brand?.name } : undefined,
  inLanguage: "en-US",
};
```

Blog-buster's `D_WebPage_missing_recommended` expects: `dateModified`, `isPartOf`, `primaryImageOfPage`, `inLanguage` (from `src/shared-lib/schema-specs.json` WebPage spec).

**Recommended addition:**
```ts
const webPage: Record<string, unknown> = {
  "@type": "WebPage",
  "@id": `${url}#webpage`,
  url,
  name: title,
  description: description || undefined,
  isPartOf: host ? { "@type": "WebSite", url: host, name: brand?.name } : undefined,
  inLanguage: "en-US",
  dateModified: new Date().toISOString().slice(0, 10),  // NEW
  primaryImageOfPage: ogImage                           // NEW
    ? { "@type": "ImageObject", url: ogImage }
    : undefined,
};
```

`ogImage` comes from `state.metaTags["og:image"]` — you already read other meta tags the same way on the preceding lines.

### A4. FAQ extractor count gap

**File:** `serp-analyzer/src/handlers/synthesize-content.ts:442-487` (`extractVisibleFaqs`)

Today's Pattern 2 restricts the search to a `<section class="faq">` / `#faq` / `[data-section='faq']` scope when no `<details>` pairs are found. If the post has question-form H2s/H3s scattered outside an explicit FAQ section, you miss them. Blog-buster's detector (`src/shared-lib/validators.ts::faqVisibleCount`) searches the entire document.

**Recommended change:** drop the scope restriction for Pattern 2, or apply it only when an explicit FAQ section exists AND contains > 0 headings:

```ts
// Pattern 2: FAQ section OR document-wide question-form headings.
const faqSection =
  root.querySelector("section.faq") ||
  root.querySelector("#faq") ||
  root.querySelector("[data-section='faq']");

// Prefer an explicit FAQ section if it has content; else scan the whole doc.
const explicitScopeHeadings =
  faqSection?.querySelectorAll("h2, h3").filter((h) => h.text.trim().includes("?")) ?? [];
const scope = explicitScopeHeadings.length > 0 ? faqSection! : root;

const headings = scope.querySelectorAll("h2, h3, h4");
// ... rest unchanged
```

This aligns with how blog-buster counts — which is what you're trying to match to close `P_faq_count_mismatch`.

### B1. New synthesizer — `S_visible_last_updated_missing`

Blog-buster's detector (`advanced-structure.ts:241-260`) looks for visible text matching:
- `last updated:` / `updated:` / `updated on` / `last revised`
- `last reviewed` / `reviewed on` / `next review` / `review by` / `review date`
- OR a written date like `"April 22, 2026"` / `"Apr 22, 2026"`

**Suggested synthesizer:**
```ts
async function synthesizeLastUpdated(
  state: HandlerState,
  instruction: Instruction,
  ctx: SynthesisContext,
): Promise<HandlerResult> {
  const base = baseResult(state, instruction);
  if (/last\s+(updated|reviewed|revised)/i.test(state.html)) {
    return { ...base, outcome: "skipped", reason: "visible last-updated already present" };
  }
  const iso = new Date().toISOString().slice(0, 10);
  const human = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric"
  });
  const block = `<p class="last-updated" data-generated="synthesize-content">Last updated: <time datetime="${iso}">${human}</time></p>`;
  const nextHtml = insertAfterH1(state.html, block);
  if (nextHtml === state.html) {
    return { ...base, outcome: "skipped", reason: "could not locate <h1> anchor" };
  }
  return { ...base, html: nextHtml, outcome: "applied", reason: `last-updated stamp inserted (${iso})` };
}
```

Wire it into the `SYNTHESIZERS` registry alongside `S_missing_DefinedTerm_schema`.

### B2. New synthesizer — `E_author_credentials_missing`

Blog-buster's detector fires when the author entity exists but has no `jobTitle` or `description`. If `ctx.request.author` has those fields, you can render a bio block visibly. If it doesn't, escalate — don't invent.

```ts
async function synthesizeAuthorCredentials(
  state: HandlerState,
  instruction: Instruction,
  ctx: SynthesisContext,
): Promise<HandlerResult> {
  const base = baseResult(state, instruction);
  const author = ctx.request.author;
  if (!author?.jobTitle && !author?.description) {
    return {
      ...base,
      outcome: "escalated",
      reason: "author.jobTitle and author.description both absent in brief — caller must populate",
    };
  }
  if (/<section[^>]*class=["'][^"']*\bauthor-bio\b/i.test(state.html)) {
    return { ...base, outcome: "skipped", reason: "author-bio block already rendered" };
  }
  const name = escapeHtml(author.name);
  const title = escapeHtml(author.jobTitle ?? "");
  const desc = escapeHtml(author.description ?? "");
  const block = `<section class="author-bio" itemscope itemtype="https://schema.org/Person">
  <h3>About the author</h3>
  <p><strong itemprop="name">${name}</strong>${title ? `<span itemprop="jobTitle"> — ${title}</span>` : ""}</p>
  ${desc ? `<p itemprop="description">${desc}</p>` : ""}
</section>`;
  // Append near the end of <article> or before </main>
  // ... your choice of anchor
  return { ...base, html: injectBeforeCloseArticle(state.html, block), outcome: "applied" };
}
```

### B3. Round cap bump

**File:** `serp-analyzer/src/blog/audit-loop.ts:72`

Today:
```ts
const maxRounds = input.maxRounds ?? 3;
```

When `runLlmLayers: true`, 3 rounds isn't enough for LLM-judge findings to cross the 7/10 threshold. The builder's Category E analysis shows `H_judge_*` findings climb ~2 points per round.

**Recommended change:**
```ts
const maxRounds = input.maxRounds ?? (input.runLlmLayers ? 5 : 3);
```

Deterministic-only runs still cap at 3 (no judge to benefit from extra rounds).

---

## What blog-buster owns (coming from my side — not work for you)

### Document-wide style fixes (Category D)

These are my side's responsibility to detect AND emit specific `apply_patch` instructions for:

- `H_em_dash_overuse` — I should emit one `apply_patch` instruction per excess em-dash occurrence, with `before: " — "` and `after: ", "` (or `". "` depending on context). Your `apply-patch` handler already handles these cleanly.
- `H_tricolon_density` — I'll emit `attempt_rewrite` instructions targeting specific spans, not document-wide rewrites.
- `H_passive_overuse` — same.

Status: I'll ship these in blog-buster v0.1.5 within a day. No action needed on your side except to route them through your existing handlers.

### LLM judge patch specificity (Category E disambiguation)

Today's LLM-judge rewrites sometimes produce `before` strings that match multiple spans in the document, and your apply-patch handler correctly refuses them (duplicate-match guard). Mine: tighten the Opus prompt so judge-sourced patches include enough enclosing context to be unique.

Status: I'll ship prompt updates in v0.1.5.

---

## Canonical markup shapes — normative spec (both sides must agree)

This is the single source of truth for what each synthesizer must emit. Adding to the handshake contract as §7a.

| Element | Canonical markup | Detector in blog-buster |
|---|---|---|
| TL;DR block | `<p data-tldr>TL;DR: …</p>` | `advanced-structure.ts::auditTldrBlock` |
| Editorial stance banner | `<aside class="editorial-stance" data-editorial="true">…</aside>` | (no detector yet — shakes-peer-only) |
| Author bio | `<section class="author-bio" itemscope itemtype="https://schema.org/Person">…</section>` | Visible byline check in `eeat/index.ts::hasVisibleByline` |
| Last updated stamp | `<p class="last-updated">Last updated: <time datetime="ISO">…</time></p>` | `advanced-structure.ts::auditVisibleLastUpdated` |
| Next review stamp | same `<p class="last-updated">` with "Next review: …" appended, OR a separate `<p class="next-review">` | same detector |
| FAQ Q/A pairs | `<h2>/<h3>/<h4>` ending with `?` followed by `<p>`/`<ul>`/`<ol>`, OR `<details><summary>Q?</summary>A</details>` | `validators.ts::faqVisibleCount` |
| DefinedTerm schema | JSON-LD entity `{ "@type": "DefinedTerm", "name": <term>, "description": <def>, "inDefinedTermSet": {…} }` | `advanced-structure.ts::auditPostTypeSchema` for definitional posts |
| BlogPosting schema | required: `headline`, `datePublished`, `author`, `image`; recommended: `dateModified`, `description`, `mainEntityOfPage`, `publisher` | `json-ld.ts::auditJsonLd` + `schema-specs.json` |
| Organization schema | required: `name`, `url`; recommended: `logo`, `sameAs` (array), `contactPoint`, `description` | same |
| WebPage schema | required: `name`, `url`; recommended: `description`, `dateModified`, `isPartOf`, `primaryImageOfPage`, `inLanguage` | same |

If you emit different markup, the detector won't count it. Either match these shapes OR raise a contract revision in `docs/handshake-contract.md` and I'll update detectors.

---

## Phase 2 — the clean split (v0.2.0, defer until after 20 real audits)

**Goal:** move *all* HTML mutation to shakes-peer. Blog-buster detects only.

### What changes on my side (v0.2.0)

- `audit()` loop max iteration drops from 5 → 1. No more inner patch application.
- All current inner-loop code (`src/engine/patcher.ts`, `src/engine/rewriter.ts`, `src/engine/planners/*`, `src/engine/handlers/*`) becomes code paths emitted as instructions, not applied.
- Every sentence-level rewrite, schema field edit, meta tag edit gets emitted as an instruction with full context in `shakespeerInstructions.instructions[]`.
- `AuditOptions` gains `internalLoop: boolean` (default `false` in v0.2.0, `true` in v0.1.x for back-compat). When `false`: detect once, return instructions, no mutation.
- Audit call becomes fast (~5-15s) and cheap (~$0.05-0.15) vs today's ~60s / $0.20-0.90.

### What changes on your side (v0.2.0)

- Your outer loop round cap goes from 3 → 5-8 (more rounds because no inner work).
- All five of your handlers stay. They already cover the full instruction taxonomy.
- Your synthesizers stay — they fill the gaps blog-buster's instruction generator can't (content that needs brief context).
- Dispatcher needs to route new instruction subtypes (coming from what's currently inner-loop logic on my side).

### Why defer

- Today works. Scores climb. Ship demos aren't blocked.
- A refactor informed by 20 real audits is cheaper than one built from speculation.
- The v0.1.x path of "blog-buster does what it can internally, hands off the rest" is less elegant but battle-tested.

### What triggers the v0.2.0 decision

If any of these start happening in production:
- Ambiguous ownership causing regressions (shakes-peer and blog-buster both mutate the same span, one overwriting the other)
- Coherence bugs where blog-buster's patch + shakes-peer's synthesizer produce conflicting markup
- Cost concerns from the 60s/audit inner loop when traffic scales

…schedule the v0.2.0 refactor for that sprint. Until then, stay on v0.1.x.

---

## How to consume this knowledge going forward

Durable knowledge transfer — you don't need me in the loop to understand the contract:

1. **This doc** — committed at `blog-buster/docs/shakespeer-coherence-brief.md`. Pull from GitHub anytime.
2. **The handshake contract** — `serp-analyzer/docs/handshake-contract.md` §1-§15 plus §7a markup spec (to be added).
3. **Blog-buster's public API** — `blog-buster/src/index.ts` exports everything you can call + all types.
4. **Detector source-of-truth** — `blog-buster/src/layers/` has one file per detector category. Each check's pass condition is readable from the code. No need to ask "what does X check look for?" — read the file.
5. **Markup-shape source-of-truth** — the table above + any detector's code. If you change a detector to accept a different shape, update the table.
6. **Instruction action taxonomy** — `blog-buster/src/output/shakespeer-instructions.ts` has the `ShakespeerInstruction` + `ShakespeerInstructionsPayload` types. They're the contract for what you'll receive.

### When things change

- Blog-buster version is in `BUILD_INFO.version` (v0.1.4+). Every audit result carries the build fingerprint. When in doubt about which rules are active, log `result.buildInfo.gitSha`.
- When I add a new check, I'll update `docs/shakespeer-coherence-brief.md` with the markup shape it expects. Pull the doc when bumping the file-dep.
- When you find a shape mismatch, raise it in the handshake contract's open-items section — I'll either loosen the detector or document the expected shape.

---

## TL;DR for the shakes-peer builder

1. **Do today** (~40 min):
   - Fix TL;DR shape at `synthesize-content.ts:122` → `<p data-tldr>…</p>`
   - Fix Organization `sameAs` + `contactPoint` stubs
   - Fix WebPage `dateModified` + `primaryImageOfPage`
   - Broaden FAQ extractor to match blog-buster's count
   - Bump `audit-loop.ts` maxRounds default to 5 when LLM enabled

2. **Do this week** (~30 min):
   - Add `S_visible_last_updated_missing` synthesizer
   - Add `E_author_credentials_missing` synthesizer
   - Force author data validation at brief boundary (1 hr per your earlier plan)

3. **Do nothing** (I'll ship v0.1.5):
   - Em-dash deterministic fix
   - Tricolon / passive rewrite with specific targets
   - LLM-judge patch disambiguation

4. **Plan for later** (v0.2.0 clean split):
   - Not this week. Not next. After 20+ real audits have run.

Every change above is grounded in the actual code I read today (serp-analyzer @ main, blog-buster @ 9da1ec6). File paths and line numbers are real. No speculation.

Questions or disagreements → raise as an issue on `github.com/tnsaruniitr-lab/blog-buster` or update the handshake contract directly. Both sides have write access to the integration.
