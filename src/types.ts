export type Layer = "technical" | "humanization" | "quality" | "eeat" | "preflight";

export interface PreflightFinding {
  check_id: string;
  severity: "critical" | "fail" | "warn" | "info";
  evidence: string;
  suggested_fix?: string;
  authority: "shakespeer" | "blog-buster" | "shared";
}

export interface RejectedPreflightFinding {
  check_id: string;
  reason: string;
}

export interface ScoreWeights {
  technical: number;
  humanization: number;
  quality: number;
}

export interface BuildInfo {
  version: string;
  gitSha: string;
  gitShaShort: string;
  gitBranch: string;
  gitDirty: boolean;
  builtAt: string;
  nodeVersion: string;
}

export type Severity = "critical" | "fail" | "warn" | "info";

export type PostType =
  | "definitional"
  | "procedural"
  | "comparison"
  | "pillar"
  | "listicle"
  | "faq"
  | "research"
  | "mechanism"
  | "general";

export type Verdict = "ship" | "edit" | "block";

export type TruthBadge =
  | "hard"
  | "measured"
  | "static"
  | "comparative"
  | "heuristic"
  | "model";

export interface AuditInput {
  slug: string;
  brand: string;
  sourceDir: string | null;
  html: string;
  articleBodyHtml: string;
  schemas: unknown[];
  metaTags: Record<string, string>;
  metadata: Record<string, unknown>;
  primaryKeyword: string | null;
  secondaryKeywords: string[];
  topic: string | null;
  wordCount: number | null;
  postType: PostType;
  rawFormat: string | null;
}

export interface Patch {
  type:
    | "replace_span"
    | "insert_schema"
    | "rewrite_paragraph"
    | "rewrite_intro"
    | "meta_tag_edit"
    | "regex_replace";
  target: string;
  before: string;
  after: string;
  rationale: string;
}

export interface Finding {
  checkId: string;
  layer: Layer;
  severity: Severity;
  evidence: string;
  sieveRules: number[];
  sieveAps: number[];
  truthBadge: TruthBadge;
  suggestedPatch?: Patch;
}

export interface LayerScores {
  technical: number;
  humanization: number;
  quality: number;
  overall: number;
}

export interface AuditIteration {
  iteration: number;
  layerScores: LayerScores;
  findings: Finding[];
  rewritesApplied: Patch[];
  delta: number;
  htmlSnapshotPath: string;
  elapsedMs: number;
  costUsd: number;
}

export interface PriorIssueStatus {
  checkId: string;
  severity: Severity;
  evidence: string;
  status: "fixed" | "still_present" | "regressed";
  previousSeverity: Severity;
}

export interface ParagraphMetric {
  index: number;
  firstWords: string;
  wordCount: number;
  sentenceCount: number;
  avgSentenceWords: number;
  emDashes: number;
  bannedPhraseHits: number;
  hedgeHits: number;
  firstPerson: boolean;
  hasQuestion: boolean;
  passiveHits: number;
  concreteNumbers: number;
  issueFlags: string[];
}

export interface AuditReport {
  slug: string;
  brand: string;
  postType: PostType;
  version: number;
  isFinal: boolean;
  previousVersions: string[];
  priorIssues: PriorIssueStatus[];
  fixedPriorIssueCount: number;
  unresolvedPriorIssueCount: number;
  regressedPriorIssueCount: number;
  paragraphMetrics: ParagraphMetric[];
  confirmedFindings: string[];
  rejectedFindings: RejectedPreflightFinding[];
  blogBusterVersion: string;
  buildInfo: BuildInfo;
  scoreWeights: ScoreWeights;
  startedAt: string;
  completedAt: string;
  status: "shipped" | "escalated" | "stalled" | "budget_exceeded" | "error";
  verdict: Verdict;
  verdictReason: string;
  stopReason: string;
  criticalCount: number;
  iterations: AuditIteration[];
  finalHtmlPath: string;
  finalScore: number;
  totalCostUsd: number;
}

export interface SchemaFieldSpec {
  required: string[];
  google_required: string[];
  recommended: string[];
  custom_checks?: string[];
}

export interface SchemaSpecs {
  version: string;
  field_specs: Record<string, SchemaFieldSpec>;
}

export interface BrainMapping {
  category: string;
  rules: number[];
  anti_patterns: number[];
  notes: string;
}

export interface BrainMappings {
  version: string;
  sieve_project_id: string;
  mappings: Record<string, BrainMapping>;
}

export interface AuditConfig {
  maxIterations: number;
  targetScore: number;
  costCapUsd: number;
  modelJudge: string;
  modelRewrite: string;
  weights: {
    technical: number;
    humanization: number;
    quality: number;
  };
}
