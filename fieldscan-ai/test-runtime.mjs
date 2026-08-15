import assert from "node:assert/strict";
import { handleScan, RUBRICS } from "./src/scan.mjs";
import {
  __mock,
  buildAssessmentJsonSchema,
  buildScanCacheKey,
  runVision,
  validateImageSources,
  VisionInputError,
  VisionProviderError,
} from "./src/vision.mjs";
import { createDevStore } from "./src/stores/dev.mjs";
import { createD1Store } from "./src/stores/d1.mjs";
import { createKvStore } from "./src/stores/kv.mjs";

const IMAGE = "data:image/jpeg;base64,/9j/aGVsbG8=";
const env = { FIELDSCAN_VISION_PROVIDER: "mock" };

function fixture(trade = "garage-doors", phase = "after") {
  const rubric = RUBRICS[trade];
  return {
    trade,
    phase,
    equipment: {
      family: rubric.equipment_families?.[0] || "unknown",
      job_mode: rubric.job_modes?.[0] || "unknown",
      nameplate_visible: false,
      visible_nameplate_facts: [],
      reason: "visible equipment",
    },
    views_present: rubric.required_views.slice(0, 2),
    missing_views: rubric.required_views.slice(2),
    not_applicable_views: [],
    safety_flags: [],
    quality_score: 80,
    score_rationale: "Clear but incomplete evidence.",
    bid_range: { low: 100, high: 200, basis: "Manager confirms." },
    overall: "needs_review",
    manager_review_required: true,
    manager_review_reasons: ["Missing evidence"],
    confidence: 0.75,
  };
}

function resetMock(responses = []) {
  __mock.calls = 0;
  __mock.responses = [...responses];
  __mock.prompts = [];
}

// Input validation is strict, bounded, and happens before model spend.
assert.throws(() => validateImageSources(["http://example.com/a.jpg"]), VisionInputError);
assert.throws(() => validateImageSources(["https://127.0.0.1/a.jpg"]), VisionInputError);
assert.throws(() => validateImageSources(["data:text/plain;base64,aGVsbG8="]), VisionInputError);
assert.throws(
  () => validateImageSources([IMAGE, IMAGE], { FIELDSCAN_MAX_IMAGES: "1" }),
  (error) => error.code === "too_many_images"
);
assert.throws(
  () => validateImageSources(
    [`data:image/jpeg;base64,${btoa("x".repeat(1025))}`],
    { FIELDSCAN_MAX_IMAGE_BYTES: "1024" }
  ),
  (error) => error.code === "image_too_large"
);
resetMock();
const invalid = await handleScan(
  { userId: "tech", trade: "garage-doors", phase: "after", images: ["http://example.com/a.jpg"] },
  createDevStore({ plans: { tech: "test" } }),
  env
);
assert.equal(invalid.status, 400);
assert.equal(__mock.calls, 0);

// Cache keys are stable, opaque, order-sensitive, and version-sensitive.
const keyInput = { userId: "tech", trade: "garage-doors", phase: "after", images: [IMAGE], env };
const keyA = await buildScanCacheKey(keyInput);
const keyB = await buildScanCacheKey(keyInput);
const keyC = await buildScanCacheKey({ ...keyInput, phase: "before" });
assert.match(keyA, /^scan:v1:[a-f0-9]{64}$/);
assert.equal(keyA, keyB);
assert.notEqual(keyA, keyC);

// A malformed model response receives one targeted correction, then succeeds.
resetMock(["not json", fixture()]);
const corrected = await handleScan(
  { userId: "retry-tech", trade: "garage-doors", phase: "after", images: [IMAGE] },
  createDevStore({ plans: { "retry-tech": "test" } }),
  env
);
assert.equal(corrected.status, 200);
assert.equal(__mock.calls, 2);
assert.match(__mock.prompts[1], /CORRECTION:/);
assert.equal(corrected.body.metering.used, 1);
assert.equal(corrected.body.missing_views.length, RUBRICS["garage-doors"].required_views.length - 2);

// Provider/config failures do not trigger a second expensive call or leak details.
const secret = "never-return-this-secret";
resetMock([new VisionProviderError("provider_request_failed")]);
const providerFailure = await handleScan(
  { userId: "fail-tech", trade: "garage-doors", phase: "after", images: [IMAGE] },
  createDevStore({ plans: { "fail-tech": "test" } }),
  { ...env, GEMINI_API_KEY: secret }
);
assert.equal(providerFailure.status, 502);
assert.equal(__mock.calls, 1);
assert.equal(providerFailure.body.reason, "provider_request_failed");
assert.doesNotMatch(JSON.stringify(providerFailure), new RegExp(secret));

// Reservation is refunded when both bounded output attempts fail.
let reservations = 0;
const reservingStore = {
  async getPlan() { return "test"; },
  async getUsage() { return reservations; },
  async reserve(_user, _period, quota) {
    if (reservations >= quota) return null;
    reservations += 1;
    return reservations;
  },
  async refund() { reservations = Math.max(0, reservations - 1); },
  async increment() { throw new Error("reserved path must not increment again"); },
};
resetMock(["bad", "still bad"]);
const badOutput = await handleScan(
  { userId: "reserved-tech", trade: "garage-doors", phase: "after", images: [IMAGE] },
  reservingStore,
  env
);
assert.equal(badOutput.status, 502);
assert.equal(__mock.calls, 2);
assert.equal(reservations, 0);

// Gemini request uses the pinned default, an API-key header, and real JSON Schema.
const originalFetch = globalThis.fetch;
let geminiRequest;
globalThis.fetch = async (url, init) => {
  geminiRequest = { url: String(url), init, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(fixture()) }] } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
};
try {
  const output = await runVision({
    rubric: RUBRICS["garage-doors"],
    phase: "after",
    images: [IMAGE],
    env: { GEMINI_API_KEY: secret },
  });
  assert.equal(JSON.parse(output).trade, "garage-doors");
} finally {
  globalThis.fetch = originalFetch;
}
assert.match(geminiRequest.url, /models\/gemini-3\.6-flash:generateContent$/);
assert.doesNotMatch(geminiRequest.url, new RegExp(secret));
assert.equal(geminiRequest.init.headers["x-goog-api-key"], secret);
assert.equal("temperature" in geminiRequest.body.generationConfig, false);
const responseFormat = geminiRequest.body.generationConfig.responseFormat.text;
assert.equal(responseFormat.mimeType, "application/json");
assert.equal(responseFormat.schema.type, "object");
assert.ok(responseFormat.schema.required.includes("manager_review_required"));
assert.deepEqual(
  buildAssessmentJsonSchema(RUBRICS.hvac, "after").properties.equipment.properties.family.enum,
  RUBRICS.hvac.equipment_families
);

// Store hardening keeps KV key compatibility and D1 uses conditional RETURNING.
const kvData = new Map();
const kv = {
  async get(key) { return kvData.get(key) ?? null; },
  async put(key, value) { kvData.set(key, value); },
};
const kvStore = createKvStore(kv);
await kvStore.setPlan("person@example.com", "pro");
assert.equal(kvData.get("plan:person@example.com"), "pro");
kvData.set("usage:person@example.com:2026-08", "-7");
assert.equal(await kvStore.getUsage("person@example.com", "2026-08"), 0);

const sqlSeen = [];
let d1Count = 0;
const db = {
  prepare(sql) {
    sqlSeen.push(sql);
    return {
      bind() { return this; },
      async first() {
        if (sql.startsWith("SELECT")) return { count: d1Count };
        if (sql.includes("RETURNING count")) { d1Count += 1; return { count: d1Count }; }
        return null;
      },
      async run() { if (sql.startsWith("UPDATE")) d1Count = Math.max(0, d1Count - 1); },
    };
  },
};
const d1 = createD1Store(db);
assert.equal(await d1.reserve("u", "2026-08", 2), 1);
await d1.refund("u", "2026-08");
assert.equal(d1Count, 0);
assert.ok(sqlSeen.some((sql) => sql.includes("WHERE usage.count < ? RETURNING count")));

console.log(JSON.stringify({
  ok: true,
  assertions: 34,
  modelCalls: 0,
  covered: ["images", "schema", "retry", "errors", "cache-key", "metering", "kv", "d1"],
}, null, 2));
