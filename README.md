# blog-buster

Iterative blog quality auditor for shakes-peer-generated posts. Three layers + iteration engine + v1/v2/v3 versioning. Produces dual-audience reports (for humans + for shakes-peer).

## What it audits

- **Technical**: HTML structure, JSON-LD schema (37 `@type` specs), meta tags, FAQ schema↔visible parity, TL;DR block, H2 extractability, word-count bands per post type
- **E-E-A-T**: author Person entity + LinkedIn sameAs, 4-human-signals bundle (byline, first-party data, original visual, outbound citations)
- **Humanization**: 14 deterministic AI-signal detectors (em-dash density, burstiness, banned phrases, tricolons, hedges, first-person, etc.) + Claude Opus judge on 7 axes
- **Content quality**: intro hook, answer extractability, specificity (Claude Sonnet judge)

## Verdict model

Every audit produces a verdict:

- ✅ **SHIP** — no criticals, overall ≥ target score
- ✏️ **EDIT** — no criticals, but score below target; humanization rewrites worth iterating
- ⛔ **BLOCK** — critical findings present; auto-escalates for human edit

Unfixable criticals cause immediate escalation — no LLM budget burned.

## Versioning

Each audit of the same `<brand>/<slug>` auto-increments v1 → v2 → v3. Version N compares its findings against version N-1 and marks each prior issue "fixed / still present / regressed". After v3, a `FINAL.html` is written stripping the shakes-peer block.

## Output

Every audit publishes to two locations by default:

```
~/Desktop/audits/reports/<brand>/<slug>/<timestamp>/
blog-buster/audit-reports/<brand>/<slug>/<timestamp>/
```

Each contains `report.html` (dual-audience), `report.json`, per-iteration artifacts, and the final HTML. A top-level `INDEX.md` is auto-updated with every run.

## Usage

```bash
npm install
cp .env.example .env                         # fill in ANTHROPIC_API_KEY
npx tsx src/cli.ts <shakespeer-output-dir>   # dual-publish by default
npx tsx src/cli.ts <dir> --no-llm            # deterministic only, no API calls
npx tsx src/cli.ts <dir> --commit            # also git-commit the repo copy
npx tsx src/cli.ts --help                    # all flags
```

## Architecture

```
src/
  input/          Shakespeer output loader + post-type inference
  layers/
    technical/    HTML, JSON-LD, meta, parity, advanced-structure
    eeat/         Author entity + human-signals bundle
    humanization/ Deterministic signals + Claude Opus judge
    quality/      Claude Sonnet judge (hook, extractability, specificity)
  engine/         Scorer, verdict, rewriter, patcher, iteration loop
  output/         Publisher, per-version report renderer, INDEX.md updater
  shared-lib/     Schema specs, brain mappings, validators, critical-metrics registry
```
