import assert from "node:assert/strict";
import {
  escapeHtml,
  gradeCardResponse,
  gradeJsonResponse,
  normalizeGradeSnapshot,
  renderAgentGradeCard,
} from "./src/ui/grade-card.mjs";
import { buildDemoHtml } from "./src/ui/demo.mjs";

const snapshot = {
  agentName: "HVAC Inspector",
  officialGrade: "A-",
  score: 9.1,
  baseline: 6.7,
  dimensions: { Accuracy: 9.4, Safety: 10, Cost: 8.2 },
  needsWork: ["Low-light nameplates"],
  sampleCount: 48,
  selfConfidence: 76,
};

assert.equal(
  escapeHtml(`<script>"go" & 'stop'</script>`),
  "&lt;script&gt;&quot;go&quot; &amp; &#39;stop&#39;&lt;/script&gt;",
);

const normalized = normalizeGradeSnapshot(snapshot);
assert.equal(normalized.delta, 2.4);
assert.equal(normalized.trend, "improving");
assert.equal(normalized.score, 9.1);
assert.equal(normalized.selfConfidence, 76);

const clamped = normalizeGradeSnapshot({ score: 99, baseline: -5, selfConfidence: 200, sampleCount: -2 });
assert.deepEqual([clamped.score, clamped.baseline, clamped.selfConfidence, clamped.sampleCount], [10, 0, 100, 0]);

const card = renderAgentGradeCard(snapshot);
assert.match(card, /Official grade/);
assert.match(card, /9\.1 <span>\/ 10<\/span>/);
assert.match(card, /\+2\.4/);
assert.match(card, /Agent-reported confidence: <strong>76%<\/strong> \(not part of the official grade\)/);
assert.match(card, /48<\/strong> evaluated samples/);
assert.match(card, /<progress max="10" value="9\.4"/);

const hostile = renderAgentGradeCard({
  agentName: `<img src=x onerror=alert(1)>`,
  score: 4.2,
  dimensions: { [`<svg onload=alert(1)>`]: 4.2 },
  needsWork: [`</li><script>alert(1)</script>`],
});
assert.doesNotMatch(hostile, /<script>|<img|<svg/);
assert.match(hostile, /&lt;img/);

const provisional = renderAgentGradeCard({ score: 7, sampleCount: 3, minimumSamples: 5 });
assert.match(provisional, /Provisional grade/);
assert.match(provisional, /2 more evaluated samples needed/);

const jsonResponse = gradeJsonResponse(snapshot);
assert.equal(jsonResponse.status, 200);
assert.match(jsonResponse.headers.get("content-type"), /application\/json/);
assert.equal(jsonResponse.headers.get("cache-control"), "no-store");
assert.equal((await jsonResponse.json()).grade.delta, 2.4);

const htmlResponse = gradeCardResponse(snapshot, { status: 202 });
assert.equal(htmlResponse.status, 202);
assert.match(htmlResponse.headers.get("content-type"), /text\/html/);
assert.match(await htmlResponse.text(), /HVAC Inspector/);

const demo = buildDemoHtml({ grade: snapshot });
assert.match(demo, /FieldScan AI/);
assert.match(demo, /Current agent grade/);
assert.match(demo, /HVAC Inspector/);
assert.match(demo, /fetch\('\/demo'/);
assert.match(demo, /aria-live="polite"/);

console.log("Agent Grade Card UI tests passed");
