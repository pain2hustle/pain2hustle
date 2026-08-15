const DEFAULT_AGENT_NAME = "Field Inspector";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function oneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function gradeForScore(score) {
  if (score >= 9.7) return "A+";
  if (score >= 9.3) return "A";
  if (score >= 9) return "A-";
  if (score >= 8.7) return "B+";
  if (score >= 8.3) return "B";
  if (score >= 8) return "B-";
  if (score >= 7.7) return "C+";
  if (score >= 7.3) return "C";
  if (score >= 7) return "C-";
  if (score >= 6) return "D";
  return "F";
}

function normalizeDimensions(dimensions) {
  const entries = Array.isArray(dimensions)
    ? dimensions.map((dimension) => [dimension?.label ?? dimension?.name, dimension?.score])
    : Object.entries(dimensions && typeof dimensions === "object" ? dimensions : {});

  return entries
    .filter(([label]) => typeof label === "string" && label.trim())
    .slice(0, 8)
    .map(([label, score]) => ({
      label: label.trim().slice(0, 48),
      score: oneDecimal(clamp(finiteNumber(score), 0, 10)),
    }));
}

export function normalizeGradeSnapshot(snapshot = {}) {
  const score = oneDecimal(clamp(finiteNumber(snapshot.score), 0, 10));
  const baseline = oneDecimal(clamp(finiteNumber(snapshot.baseline, score), 0, 10));
  const delta = oneDecimal(score - baseline);
  const trend = delta > 0 ? "improving" : delta < 0 ? "declining" : "steady";
  const suppliedGrade = String(snapshot.officialGrade ?? "").trim().toUpperCase();

  return {
    agentName: String(snapshot.agentName || DEFAULT_AGENT_NAME).trim().slice(0, 80),
    officialGrade: /^[A-F][+-]?$/.test(suppliedGrade) ? suppliedGrade : gradeForScore(score),
    score,
    baseline,
    delta,
    trend,
    dimensions: normalizeDimensions(snapshot.dimensions),
    needsWork: (Array.isArray(snapshot.needsWork) ? snapshot.needsWork : [])
      .filter((item) => typeof item === "string" && item.trim())
      .slice(0, 5)
      .map((item) => item.trim().slice(0, 160)),
    sampleCount: Math.max(0, Math.floor(finiteNumber(snapshot.sampleCount))),
    selfConfidence: Math.round(clamp(finiteNumber(snapshot.selfConfidence), 0, 100)),
    minimumSamples: Math.max(1, Math.floor(finiteNumber(snapshot.minimumSamples, 20))),
  };
}

export const AGENT_GRADE_CARD_STYLES = `
.agent-grade-card{--grade-accent:#59d994;--grade-muted:#95a8c8;background:linear-gradient(145deg,rgba(22,34,55,.98),rgba(13,23,41,.98));border:1px solid #293852;border-radius:16px;color:#edf4ff;padding:20px;box-shadow:0 18px 50px rgba(0,0,0,.18)}
.agent-grade-card *{box-sizing:border-box}.grade-card-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.grade-eyebrow,.grade-label{color:var(--grade-muted);font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}.grade-card-title{font-size:19px;line-height:1.25;margin:3px 0 0}.grade-official{text-align:right}.grade-letter{color:var(--grade-accent);font-size:34px;font-weight:850;letter-spacing:-.04em;line-height:1}.grade-score{font-size:14px;font-weight:700;margin-top:3px}.grade-score span{color:var(--grade-muted);font-weight:500}.grade-summary{align-items:center;border-bottom:1px solid #293852;border-top:1px solid #293852;display:grid;gap:12px;grid-template-columns:repeat(3,1fr);margin:16px 0;padding:13px 0}.grade-stat strong{display:block;font-size:16px}.grade-trend{color:var(--grade-accent)}.grade-trend[data-trend="declining"]{color:#ff7885}.grade-trend[data-trend="steady"]{color:#f6c766}.grade-dimensions{display:grid;gap:10px;margin-top:9px}.grade-dimension{display:grid;gap:8px;grid-template-columns:minmax(90px,1fr) 2fr 34px;align-items:center;font-size:13px}.grade-dimension progress{accent-color:var(--grade-accent);height:8px;width:100%}.grade-dimension output{text-align:right;font-variant-numeric:tabular-nums}.grade-needs-work{background:rgba(246,199,102,.07);border:1px solid rgba(246,199,102,.24);border-radius:10px;margin-top:16px;padding:12px}.grade-needs-work ul{margin:7px 0 0;padding-left:18px}.grade-needs-work li+li{margin-top:4px}.grade-confidence{border-top:1px solid #293852;color:var(--grade-muted);font-size:12px;margin-top:16px;padding-top:12px}.grade-confidence strong{color:#dbe7fa}.grade-provisional{color:#f6c766;font-size:12px;margin-top:9px}@media(max-width:520px){.grade-summary{grid-template-columns:1fr 1fr}.grade-dimension{grid-template-columns:90px 1fr 30px}}
`;

export function renderAgentGradeCard(snapshot = {}) {
  const grade = normalizeGradeSnapshot(snapshot);
  const delta = `${grade.delta > 0 ? "+" : ""}${grade.delta.toFixed(1)}`;
  const dimensions = grade.dimensions.length
    ? grade.dimensions.map((dimension) => `
      <div class="grade-dimension">
        <span>${escapeHtml(dimension.label)}</span>
        <progress max="10" value="${dimension.score}" aria-label="${escapeHtml(dimension.label)} score: ${dimension.score} out of 10"></progress>
        <output>${dimension.score.toFixed(1)}</output>
      </div>`).join("")
    : '<p class="grade-confidence">No dimension scores recorded yet.</p>';
  const needsWork = grade.needsWork.length
    ? `<ul>${grade.needsWork.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : '<p>No targeted improvements currently open.</p>';
  const provisional = grade.sampleCount < grade.minimumSamples
    ? `<p class="grade-provisional" role="status">Provisional grade — ${grade.minimumSamples - grade.sampleCount} more evaluated sample${grade.minimumSamples - grade.sampleCount === 1 ? "" : "s"} needed.</p>`
    : "";

  return `<article class="agent-grade-card" aria-labelledby="agent-grade-title">
    <header class="grade-card-header">
      <div><div class="grade-eyebrow">Agent performance</div><h2 class="grade-card-title" id="agent-grade-title">${escapeHtml(grade.agentName)}</h2></div>
      <div class="grade-official" aria-label="Official grade ${escapeHtml(grade.officialGrade)}, ${grade.score.toFixed(1)} out of 10">
        <div class="grade-label">Official grade</div><div class="grade-letter">${escapeHtml(grade.officialGrade)}</div><div class="grade-score">${grade.score.toFixed(1)} <span>/ 10</span></div>
      </div>
    </header>
    ${provisional}
    <div class="grade-summary" aria-label="Grade history">
      <div class="grade-stat"><span class="grade-label">Baseline</span><strong>${grade.baseline.toFixed(1)}</strong></div>
      <div class="grade-stat"><span class="grade-label">Change</span><strong>${delta}</strong></div>
      <div class="grade-stat"><span class="grade-label">Trend</span><strong class="grade-trend" data-trend="${grade.trend}">${grade.trend}</strong></div>
    </div>
    <section aria-labelledby="grade-dimensions-title"><h3 class="grade-label" id="grade-dimensions-title">Measured dimensions</h3><div class="grade-dimensions">${dimensions}</div></section>
    <section class="grade-needs-work" aria-labelledby="grade-needs-work-title"><h3 class="grade-label" id="grade-needs-work-title">Needs work</h3>${needsWork}</section>
    <footer class="grade-confidence"><strong>${grade.sampleCount}</strong> evaluated samples · Agent-reported confidence: <strong>${grade.selfConfidence}%</strong> (not part of the official grade)</footer>
  </article>`;
}

export function gradeJsonResponse(snapshot, init = {}) {
  return new Response(JSON.stringify({ grade: normalizeGradeSnapshot(snapshot) }), {
    ...init,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

export function gradeCardResponse(snapshot, init = {}) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent grade</title><style>${AGENT_GRADE_CARD_STYLES}</style></head><body style="background:#0b1220;margin:0;padding:24px;font-family:system-ui,sans-serif"><main style="max-width:680px;margin:auto">${renderAgentGradeCard(snapshot)}</main></body></html>`;
  return new Response(body, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}
