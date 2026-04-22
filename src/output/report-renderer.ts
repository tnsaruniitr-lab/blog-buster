import type {
  AuditReport,
  Finding,
  ParagraphMetric,
  PriorIssueStatus,
  Severity,
} from "../types.js";
import { metricFor } from "../shared-lib/critical-metrics.js";
import { buildShakespeerInstructions } from "./shakespeer-instructions.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sevColor(sev: Severity): string {
  if (sev === "critical") return "#7b1414";
  if (sev === "fail") return "#c0392b";
  if (sev === "warn") return "#e67e22";
  return "#2980b9";
}

function verdictBanner(verdict: string): { bg: string; fg: string; label: string } {
  if (verdict === "ship") return { bg: "#1e8449", fg: "#fff", label: "SHIP" };
  if (verdict === "edit") return { bg: "#e67e22", fg: "#fff", label: "EDIT" };
  return { bg: "#7b1414", fg: "#fff", label: "BLOCK" };
}

function prioritizeForHumans(findings: Finding[]): Finding[] {
  const order = { critical: 0, fail: 1, warn: 2, info: 3 } as const;
  return [...findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, 6);
}

function renderForHumansBlock(report: AuditReport): string {
  const final = report.iterations[report.iterations.length - 1];
  const findings = final?.findings ?? [];
  const top = prioritizeForHumans(findings);
  const vb = verdictBanner(report.verdict);
  const actionList = top
    .map(
      (f) =>
        `<li><span class="pill" style="background:${sevColor(f.severity)}">${f.severity}</span> <b>${esc(f.checkId)}</b> — ${esc(f.evidence)}</li>`,
    )
    .join("");

  const tldr = `${report.brand} · ${report.postType} post · version v${report.version}${report.isFinal ? " (FINAL)" : ""} · score ${report.finalScore}/100 · ${report.criticalCount} critical · ${report.iterations.length} LLM iteration(s) · $${report.totalCostUsd.toFixed(3)}`;

  return `
  <section class="for-humans">
    <div class="audience-tag">FOR HUMANS</div>
    <div class="verdict" style="background:${vb.bg};color:${vb.fg}">${vb.label}</div>
    <p class="tldr">${esc(tldr)}</p>
    <p><b>Reason:</b> ${esc(report.verdictReason)}</p>
    <h3>Top ${top.length} action items</h3>
    <ul class="actions">${actionList || "<li>No issues — ready to ship.</li>"}</ul>
  </section>`;
}

function renderForShakesPeerBlock(report: AuditReport): string {
  if (report.isFinal) return "";
  const payload = buildShakespeerInstructions(report, 90);
  return `
  <section class="for-shakespeer">
    <div class="audience-tag shakespeer">FOR SHAKES-PEER</div>
    <p>Structured fix plan. Parse the JSON, apply patches, regenerate the post, and re-run <code>blog-buster</code> against the new version.</p>
    <p><b>Loop protocol:</b> v${report.version} → shakes-peer fixes → v${report.version + 1} → ${report.version + 1 >= 3 ? "FINAL" : "loop continues"}</p>
    <pre class="shakespeer-payload">${esc(JSON.stringify(payload, null, 2))}</pre>
  </section>`;
}

function renderPriorIssuesDiff(report: AuditReport): string {
  if (!report.priorIssues.length) return "";
  const statusEmoji = (s: PriorIssueStatus["status"]) =>
    s === "fixed" ? "✅ fixed" : s === "regressed" ? "⚠️ regressed" : "❌ still present";

  const rows = report.priorIssues
    .map(
      (p) => `<tr>
        <td><code>${esc(p.checkId)}</code></td>
        <td><span class="pill" style="background:${sevColor(p.previousSeverity)}">${p.previousSeverity}</span></td>
        <td>${statusEmoji(p.status)}</td>
        <td>${p.status === "fixed" ? "<i>resolved</i>" : esc(p.evidence)}</td>
      </tr>`,
    )
    .join("");
  return `
  <h2>v${report.version - 1} → v${report.version} — prior-issue diff</h2>
  <p>Fixed: <b>${report.fixedPriorIssueCount}</b> · Still present: <b>${report.unresolvedPriorIssueCount}</b> · Regressed: <b>${report.regressedPriorIssueCount}</b></p>
  <table>
    <thead><tr><th>Check</th><th>Prev severity</th><th>Status</th><th>Current evidence</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderParagraphMetrics(report: AuditReport): string {
  const pm = report.paragraphMetrics;
  if (!pm.length) return "";
  const flagged = pm.filter((p) => p.issueFlags.length);
  const rowsFor = (list: ParagraphMetric[]) =>
    list
      .map(
        (p) => `<tr>
      <td>${p.index + 1}</td>
      <td><small>${esc(p.firstWords)}</small></td>
      <td>${p.wordCount}</td>
      <td>${p.sentenceCount}</td>
      <td>${p.avgSentenceWords}</td>
      <td>${p.emDashes}</td>
      <td>${p.bannedPhraseHits}</td>
      <td>${p.hedgeHits}</td>
      <td>${p.firstPerson ? "✓" : "—"}</td>
      <td>${p.hasQuestion ? "?" : "—"}</td>
      <td>${p.concreteNumbers}</td>
      <td>${p.issueFlags.length ? `<span class="flags">${p.issueFlags.join(", ")}</span>` : "—"}</td>
    </tr>`,
      )
      .join("");

  return `
  <h2>Per-paragraph metrics</h2>
  <p>${pm.length} paragraph(s) analyzed · <b>${flagged.length}</b> flagged with at least one issue.</p>
  <table class="para-metrics">
    <thead><tr>
      <th>#</th><th>Opening</th><th>Words</th><th>Sents</th><th>Avg W/S</th>
      <th>em—</th><th>Banned</th><th>Hedges</th><th>1p</th><th>?</th><th>Nums</th><th>Flags</th>
    </tr></thead>
    <tbody>${rowsFor(flagged.length ? flagged : pm.slice(0, 10))}</tbody>
  </table>`;
}

function renderCriticalRubric(report: AuditReport): string {
  const final = report.iterations[report.iterations.length - 1];
  const criticals = (final?.findings ?? []).filter((f) => f.severity === "critical");
  if (!criticals.length) return "";
  const rows = criticals
    .map((f) => {
      const m = metricFor(f.checkId);
      if (!m) {
        return `<tr>
          <td><code>${esc(f.checkId)}</code></td>
          <td>${esc(f.evidence)}</td>
          <td>—</td><td>—</td><td>—</td><td>—</td>
        </tr>`;
      }
      return `<tr>
        <td><code>${esc(m.checkId)}</code><br><small>${esc(m.category)}</small></td>
        <td>${esc(m.label)}<br><small>${esc(f.evidence)}</small></td>
        <td>${esc(m.metricType)}</td>
        <td>${esc(m.target)}</td>
        <td>${m.weight}</td>
        <td>${m.autoFixable ? "✓ auto" : "human"}<br><small>${esc(m.fixHint)}</small></td>
      </tr>`;
    })
    .join("");
  return `
  <h2>Critical metrics rubric</h2>
  <p>Every critical finding measured against its pass target. Weight = score penalty.</p>
  <table>
    <thead><tr><th>Check · Category</th><th>Metric · Evidence</th><th>Type</th><th>Pass target</th><th>Weight</th><th>Fix</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function findingRow(f: Finding): string {
  const patch = f.suggestedPatch
    ? `<details><summary>suggested patch</summary><pre>${esc(JSON.stringify(f.suggestedPatch, null, 2))}</pre></details>`
    : "";
  return `<tr>
    <td><span class="pill" style="background:${sevColor(f.severity)}">${f.severity}</span></td>
    <td>${esc(f.layer)}</td>
    <td><code>${esc(f.checkId)}</code></td>
    <td>${esc(f.evidence)}${patch}</td>
    <td>${esc(f.truthBadge)}</td>
  </tr>`;
}

function renderIterations(report: AuditReport): string {
  return report.iterations
    .map((iter) => {
      const rows = iter.findings.map(findingRow).join("");
      return `
      <section class="iter">
        <h3>Iteration ${iter.iteration} — overall ${iter.layerScores.overall} (Δ ${iter.delta >= 0 ? "+" : ""}${iter.delta})</h3>
        <div class="scores">
          technical: <b>${iter.layerScores.technical}</b> ·
          humanization: <b>${iter.layerScores.humanization}</b> ·
          quality: <b>${iter.layerScores.quality}</b> ·
          findings: <b>${iter.findings.length}</b> ·
          patches applied: <b>${iter.rewritesApplied.length}</b> ·
          cost: <b>$${iter.costUsd.toFixed(4)}</b>
        </div>
        <table>
          <thead><tr><th>Sev</th><th>Layer</th><th>Check</th><th>Evidence</th><th>Truth</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">no findings</td></tr>'}</tbody>
        </table>
      </section>`;
    })
    .join("");
}

const STYLE = `
  body{font:14px/1.55 -apple-system,BlinkMacSystemFont,sans-serif;margin:2rem;color:#222;max-width:1150px}
  h1{margin-bottom:.2rem}
  h2{margin-top:2rem;border-bottom:1px solid #ddd;padding-bottom:.3rem}
  .meta{color:#666;margin-bottom:1.5rem}
  section.for-humans,section.for-shakespeer{border:2px solid;border-radius:8px;padding:1rem 1.2rem;margin-bottom:1rem}
  section.for-humans{border-color:#2980b9;background:#f5f9fc}
  section.for-shakespeer{border-color:#8e44ad;background:#f9f4fb}
  .audience-tag{font-size:11px;letter-spacing:1.2px;font-weight:700;color:#555;margin-bottom:.5rem}
  .audience-tag.shakespeer{color:#6c3483}
  .verdict{display:inline-block;padding:8px 18px;border-radius:6px;font-weight:700;font-size:18px;letter-spacing:.5px;margin-bottom:.5rem}
  .tldr{color:#444;font-size:13px;margin:.4rem 0}
  ul.actions{margin:0;padding-left:1.2rem}
  ul.actions li{margin:.3rem 0}
  pre.shakespeer-payload{background:#fff;border:1px solid #d7c3dc;padding:10px;font-size:11.5px;overflow-x:auto;max-height:500px}
  .summary{background:#f7f7f9;padding:1rem;border-radius:6px;margin-bottom:1rem}
  .scores{color:#555;margin:.4rem 0 .8rem;font-size:13px}
  section.iter{border:1px solid #e4e4e4;border-radius:6px;padding:1rem;margin-bottom:1.2rem}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:.5rem}
  table.para-metrics{font-size:11.5px}
  table.para-metrics th,table.para-metrics td{padding:3px 6px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}
  th{background:#fafafa}
  code{background:#f1f1f1;padding:1px 5px;border-radius:3px;font-size:12px}
  .pill{color:white;padding:2px 8px;border-radius:10px;font-size:10.5px;font-weight:600;text-transform:uppercase}
  .flags{color:#b55;font-size:11px}
  pre{background:#f7f7f7;padding:8px;border-radius:4px;font-size:11px;overflow-x:auto}
  details{margin-top:4px}
  summary{cursor:pointer;color:#2980b9;font-size:12px}
`;

export function renderHtmlReport(report: AuditReport): string {
  const versionLabel = report.isFinal ? `v${report.version} · FINAL` : `v${report.version}`;
  const priorList = report.previousVersions.length
    ? ` · prior: ${report.previousVersions.map((t) => `<code>${esc(t)}</code>`).join(", ")}`
    : "";
  const header = `
    <h1>${esc(report.slug)} <span style="color:#888;font-size:16px">[${versionLabel}]</span></h1>
    <div class="meta">brand: ${esc(report.brand)} · type: <code>${esc(report.postType)}</code> · ${esc(report.startedAt)} → ${esc(report.completedAt)}${priorList}</div>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Audit ${versionLabel} — ${esc(report.slug)}</title>
<style>${STYLE}</style></head><body>
  ${header}
  ${renderForHumansBlock(report)}
  ${renderForShakesPeerBlock(report)}
  ${renderPriorIssuesDiff(report)}
  ${renderCriticalRubric(report)}
  ${renderParagraphMetrics(report)}
  <h2>Iteration detail</h2>
  ${renderIterations(report)}
  <h2>Summary</h2>
  <div class="summary">
    <b>Status:</b> ${esc(report.status)} ·
    <b>Final score:</b> ${report.finalScore} ·
    <b>Criticals:</b> ${report.criticalCount} ·
    <b>Iterations:</b> ${report.iterations.length} ·
    <b>Total cost:</b> $${report.totalCostUsd.toFixed(4)}<br>
    <b>Stop reason:</b> ${esc(report.stopReason)}<br>
    <b>Final HTML:</b> <code>${esc(report.finalHtmlPath)}</code>
  </div>
</body></html>`;
}

export function renderFinalHumanOnly(report: AuditReport): string {
  const vb = verdictBanner(report.verdict);
  const final = report.iterations[report.iterations.length - 1];
  const findings = final?.findings ?? [];
  const top = prioritizeForHumans(findings);
  const actionList = top
    .map(
      (f) =>
        `<li><span class="pill" style="background:${sevColor(f.severity)}">${f.severity}</span> <b>${esc(f.checkId)}</b> — ${esc(f.evidence)}</li>`,
    )
    .join("");

  const historyRows = [...report.previousVersions, report.startedAt]
    .map(
      (ts, i) =>
        `<tr><td>v${i + 1}${i === report.previousVersions.length ? " (this)" : ""}</td><td><code>${esc(ts)}</code></td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>FINAL Audit — ${esc(report.slug)}</title>
<style>${STYLE}</style></head><body>
  <h1>${esc(report.slug)} <span style="color:#888;font-size:16px">[v${report.version} · FINAL]</span></h1>
  <div class="meta">brand: ${esc(report.brand)} · type: <code>${esc(report.postType)}</code> · ${esc(report.completedAt)}</div>
  <section class="for-humans">
    <div class="audience-tag">FOR HUMANS — consolidated final report</div>
    <div class="verdict" style="background:${vb.bg};color:${vb.fg}">${vb.label}</div>
    <p><b>Final score:</b> ${report.finalScore}/100 · <b>Criticals remaining:</b> ${report.criticalCount}</p>
    <p><b>Reason:</b> ${esc(report.verdictReason)}</p>
    <h3>Remaining issues (top ${top.length})</h3>
    <ul class="actions">${actionList || "<li>No issues — ready to ship.</li>"}</ul>
  </section>
  <h2>Version history</h2>
  <table><thead><tr><th>Version</th><th>Timestamp</th></tr></thead><tbody>${historyRows}</tbody></table>
  ${renderPriorIssuesDiff(report)}
  ${renderParagraphMetrics(report)}
</body></html>`;
}
