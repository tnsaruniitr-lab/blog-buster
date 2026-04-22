import "dotenv/config";
import type { AuditConfig } from "./types.js";

export const config: AuditConfig = {
  maxIterations: Number(process.env.BLOG_AUDITOR_MAX_ITERATIONS ?? 5),
  targetScore: Number(process.env.BLOG_AUDITOR_TARGET_SCORE ?? 90),
  costCapUsd: Number(process.env.BLOG_AUDITOR_COST_CAP_USD ?? 0.75),
  modelJudge: process.env.BLOG_AUDITOR_MODEL_JUDGE ?? "claude-opus-4-7",
  modelRewrite: process.env.BLOG_AUDITOR_MODEL_REWRITE ?? "claude-sonnet-4-6",
  weights: {
    technical: 0.35,
    humanization: 0.4,
    quality: 0.25,
  },
};

export const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? "";
