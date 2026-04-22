import Anthropic from "@anthropic-ai/sdk";
import { anthropicApiKey } from "./config.js";

export const anthropic = new Anthropic({ apiKey: anthropicApiKey });

const PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  "claude-opus-4-7": { inputPerM: 15, outputPerM: 75 },
  "claude-sonnet-4-6": { inputPerM: 3, outputPerM: 15 },
  "claude-haiku-4-5-20251001": { inputPerM: 0.8, outputPerM: 4 },
};

export function costForUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (inputTokens / 1_000_000) * p.inputPerM + (outputTokens / 1_000_000) * p.outputPerM;
}

export interface CallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function callClaude(params: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  cacheSystem?: boolean;
}): Promise<CallResult> {
  const systemBlocks = params.cacheSystem
    ? [{ type: "text" as const, text: params.system, cache_control: { type: "ephemeral" as const } }]
    : [{ type: "text" as const, text: params.system }];

  const resp = await anthropic.messages.create({
    model: params.model,
    max_tokens: params.maxTokens ?? 2048,
    system: systemBlocks,
    messages: [{ role: "user", content: params.user }],
  });

  const text = resp.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  const inputTokens = resp.usage.input_tokens + (resp.usage.cache_read_input_tokens ?? 0);
  const outputTokens = resp.usage.output_tokens;

  return {
    text,
    inputTokens,
    outputTokens,
    costUsd: costForUsage(params.model, resp.usage.input_tokens, outputTokens),
  };
}
