import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { callClaude, type CallResult } from "../../anthropic-client.js";
import { visibleText } from "../../shared-lib/validators.js";
import { config } from "../../config.js";
import type { AuditInput, Finding, Patch } from "../../types.js";

const here = dirname(fileURLToPath(import.meta.url));
const JUDGE_PROMPT = readFileSync(join(here, "../../../prompts/humanization-judge.md"), "utf-8");

interface JudgeAxis {
  name: string;
  score: number;
  worst_sentence: string | null;
  suggested_rewrite: string | null;
  reason: string;
}

interface JudgeResponse {
  axes: JudgeAxis[];
  overall_impression: string;
}

function parseJudge(text: string): JudgeResponse | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as JudgeResponse;
  } catch {
    return null;
  }
}

export async function runHumanizationJudge(
  input: AuditInput,
): Promise<{ findings: Finding[]; score: number; cost: number; raw: CallResult | null }> {
  const text = visibleText(input.articleBodyHtml || input.html).slice(0, 12_000);
  const userPrompt = `Post topic: ${input.topic ?? "unknown"}\nPrimary keyword: ${input.primaryKeyword ?? "n/a"}\n\nPost content:\n---\n${text}\n---`;

  const result = await callClaude({
    model: config.modelJudge,
    system: JUDGE_PROMPT,
    user: userPrompt,
    maxTokens: 2048,
    cacheSystem: true,
  });

  const parsed = parseJudge(result.text);
  if (!parsed) {
    return {
      findings: [
        {
          checkId: "H_judge_parse_error",
          layer: "humanization",
          severity: "info",
          evidence: "LLM judge returned unparseable JSON",
          sieveRules: [],
          sieveAps: [],
          truthBadge: "model",
        },
      ],
      score: 70,
      cost: result.costUsd,
      raw: result,
    };
  }

  const findings: Finding[] = [];
  for (const axis of parsed.axes) {
    if (axis.score >= 7) continue;
    const severity = axis.score <= 3 ? "fail" : "warn";
    const patch: Patch | undefined =
      axis.worst_sentence && axis.suggested_rewrite
        ? {
            type: "replace_span",
            target: axis.worst_sentence,
            before: axis.worst_sentence,
            after: axis.suggested_rewrite,
            rationale: `Humanization axis "${axis.name}" scored ${axis.score}/10: ${axis.reason}`,
          }
        : undefined;
    findings.push({
      checkId: `H_judge_${axis.name.replace(/\s+/g, "_").toLowerCase().slice(0, 40)}`,
      layer: "humanization",
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

  return { findings, score, cost: result.costUsd, raw: result };
}
