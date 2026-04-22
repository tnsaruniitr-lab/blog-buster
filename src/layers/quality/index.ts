import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { callClaude } from "../../anthropic-client.js";
import { config } from "../../config.js";
import { visibleText } from "../../shared-lib/validators.js";
import type { AuditInput, Finding, Patch } from "../../types.js";

const here = dirname(fileURLToPath(import.meta.url));
const PROMPT = readFileSync(join(here, "../../../prompts/content-quality.md"), "utf-8");

interface QualityAxis {
  name: string;
  score: number;
  worst_sentence: string | null;
  suggested_rewrite: string | null;
  reason: string;
}

interface QualityResponse {
  axes: QualityAxis[];
}

function parse(text: string): QualityResponse | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as QualityResponse;
  } catch {
    return null;
  }
}

export interface QualityResult {
  findings: Finding[];
  score: number;
  cost: number;
}

export async function runQualityLayer(
  input: AuditInput,
  opts: { runJudge: boolean },
): Promise<QualityResult> {
  if (!opts.runJudge) {
    return { findings: [], score: 70, cost: 0 };
  }

  const text = visibleText(input.articleBodyHtml || input.html).slice(0, 10_000);
  const user = `Primary keyword: ${input.primaryKeyword ?? "unknown"}\nTopic: ${input.topic ?? "unknown"}\n\nPost:\n---\n${text}\n---`;

  const result = await callClaude({
    model: config.modelRewrite,
    system: PROMPT,
    user,
    maxTokens: 1500,
    cacheSystem: true,
  });

  const parsed = parse(result.text);
  if (!parsed) {
    return {
      findings: [
        {
          checkId: "Q_parse_error",
          layer: "quality",
          severity: "info",
          evidence: "Quality judge returned unparseable JSON",
          sieveRules: [],
          sieveAps: [],
          truthBadge: "model",
        },
      ],
      score: 70,
      cost: result.costUsd,
    };
  }

  const findings: Finding[] = [];
  for (const axis of parsed.axes) {
    if (axis.score >= 7) continue;
    const severity = axis.score <= 3 ? "fail" : "warn";
    const patch: Patch | undefined =
      axis.worst_sentence && axis.suggested_rewrite
        ? {
            type: axis.name === "intro_hook" ? "rewrite_intro" : "replace_span",
            target: axis.worst_sentence,
            before: axis.worst_sentence,
            after: axis.suggested_rewrite,
            rationale: `Quality axis "${axis.name}" scored ${axis.score}/10: ${axis.reason}`,
          }
        : undefined;
    findings.push({
      checkId: `Q_${axis.name}`,
      layer: "quality",
      severity,
      evidence: `${axis.name} ${axis.score}/10 — ${axis.reason}`,
      sieveRules: [],
      sieveAps: [],
      truthBadge: "model",
      suggestedPatch: patch,
    });
  }

  const avg = parsed.axes.reduce((a, b) => a + b.score, 0) / (parsed.axes.length || 1);
  const score = Math.max(0, Math.min(100, Math.round(avg * 10)));

  return { findings, score, cost: result.costUsd };
}
