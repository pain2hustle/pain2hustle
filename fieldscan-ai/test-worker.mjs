import assert from "node:assert/strict";
import worker from "./src/index.mjs";

const request = (path, init = {}) => worker.fetch(new Request(`https://fieldscan.test${path}`, init), {});

const home = await request("/");
assert.equal(home.status, 200);
const homeHtml = await home.text();
assert.match(homeHtml, /FieldScan Orchestrator/);
assert.match(homeHtml, /Official grade/);

const gradeJson = await request("/grade", { headers: { accept: "application/json" } });
assert.equal(gradeJson.status, 200);
assert.equal(gradeJson.headers.get("cache-control"), "no-store");
const grade = await gradeJson.json();
assert.equal(grade.grade.score, 8.2);
assert.equal(grade.grade.baseline, 5.8);
assert.equal(grade.grade.delta, 2.4);

const gradeHtml = await request("/grade", { headers: { accept: "text/html" } });
assert.equal(gradeHtml.status, 200);
assert.match(await gradeHtml.text(), /Agent performance/);

const failClosed = await request("/scan", { method: "POST", body: "{}" });
assert.equal(failClosed.status, 503);
assert.deepEqual(await failClosed.json(), { error: "auth_not_configured" });

const unauthorized = await worker.fetch(new Request("https://fieldscan.test/scan", {
  method: "POST",
  headers: { "x-fieldscan-secret": "wrong" },
  body: "{}",
}), { FIELDSCAN_AUTH_SECRET: "configured" });
assert.equal(unauthorized.status, 401);

const wrongLength = await worker.fetch(new Request("https://fieldscan.test/scan", {
  method: "POST",
  headers: { "x-fieldscan-secret": "x" },
  body: "{}",
}), { FIELDSCAN_AUTH_SECRET: "a-much-longer-configured-secret" });
assert.equal(wrongLength.status, 401);

const taskList = await worker.fetch(new Request("https://fieldscan.test/tasks", {
  headers: { "x-fieldscan-secret": "configured" },
}), { FIELDSCAN_AUTH_SECRET: "configured" });
assert.equal(taskList.status, 200);
assert.equal((await taskList.json()).taskKeys.length, 18);

const plan = await worker.fetch(new Request("https://fieldscan.test/plan", {
  method: "POST",
  headers: { "content-type": "application/json", "x-fieldscan-secret": "configured" },
  body: JSON.stringify({
    request: {
      taskKey: "hvac.inspect.after.high-risk.v1",
      inputRefs: ["photo-1"],
      policyVersion: "hvac-2026.08",
      budget: { maxTokens: 0, maxCostUsd: 0, deadlineMs: 1000 },
    },
    assets: [{
      ref: "photo-1",
      sha256: "a".repeat(64),
      mimeType: "image/jpeg",
      width: 1200,
      height: 900,
    }],
    observations: [{
      requirement: "completed work overview",
      evidenceRef: "photo-1",
      present: true,
    }],
  }),
}), { FIELDSCAN_AUTH_SECRET: "configured" });
assert.equal(plan.status, 200);
const planned = await plan.json();
assert.equal(planned.plan.intent.risk, "high");
assert.equal(planned.plan.gates.managerApproval, true);
assert.equal(planned.context.ledger.resultCount, 3);
assert.equal(planned.context.status, "needs_more");

console.log("Worker route tests passed");
