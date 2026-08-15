// Core /scan handler — framework-agnostic. Called by the Cloudflare Worker
// (src/index.mjs) and directly by test.mjs. Knows nothing about HTTP; it takes
// a parsed request body, a usage store, and env, and returns { status, body }.

import { reserveScan, recordScan, releaseScanReservation, currentPeriod } from "./metering.mjs";
import {
  runVision,
  activeProvider,
  validateImageSources,
  VisionInputError,
  VisionProviderError,
  buildScanCacheKey,
} from "./vision.mjs";
import garageDoors from "../rubrics/garage-doors.json" with { type: "json" };
import hvac from "../rubrics/hvac.json" with { type: "json" };

const RUBRICS = {
  "garage-doors": garageDoors,
  hvac,
};

const VALID_PHASES = new Set(["before", "during", "after"]);

class ModelOutputError extends Error {
  constructor(code) {
    super(code);
    this.name = "ModelOutputError";
    this.code = code;
  }
}

// Accept JSON or a single JSON code fence. Arbitrary prose and substring
// extraction are rejected so retries correct the model rather than guessing.
export function extractJson(text) {
  if (typeof text !== "string" || !text.trim()) throw new ModelOutputError("empty_output");
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1].trim();
  try {
    const value = JSON.parse(t);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ModelOutputError("output_not_object");
    }
    return value;
  } catch {
    throw new ModelOutputError("invalid_json");
  }
}

function validStringArray(value, max) {
  return Array.isArray(value) && value.length <= max && value.every((item) => typeof item === "string");
}

function requireModelShape(obj, trade, phase, rubric) {
  const views = new Set(rubric.required_views || []);
  const families = new Set(rubric.equipment_families?.length ? rubric.equipment_families : ["unknown"]);
  const modes = new Set(rubric.job_modes?.length ? rubric.job_modes : ["unknown"]);
  const equipment = obj.equipment;
  const bid = obj.bid_range;
  const validViewArray = (value) => validStringArray(value, views.size) && value.every((item) => views.has(item));
  const validNumber = (value, min, max = Infinity) => Number.isFinite(value) && value >= min && value <= max;
  const ok =
    obj.trade === trade &&
    obj.phase === phase &&
    equipment && typeof equipment === "object" && !Array.isArray(equipment) &&
    families.has(equipment.family) && modes.has(equipment.job_mode) &&
    typeof equipment.nameplate_visible === "boolean" &&
    validStringArray(equipment.visible_nameplate_facts, 20) &&
    typeof equipment.reason === "string" &&
    validViewArray(obj.views_present) &&
    validViewArray(obj.missing_views) &&
    Array.isArray(obj.not_applicable_views) && obj.not_applicable_views.length <= views.size &&
    obj.not_applicable_views.every((item) => item && views.has(item.view) && typeof item.reason === "string") &&
    Array.isArray(obj.safety_flags) && obj.safety_flags.length <= 20 &&
    obj.safety_flags.every((flag) => flag && typeof flag.issue === "string" &&
      ["low", "med", "high"].includes(flag.severity) && typeof flag.evidence === "string") &&
    validNumber(obj.quality_score, 0, 100) &&
    typeof obj.score_rationale === "string" &&
    bid && typeof bid === "object" && validNumber(bid.low, 0) && validNumber(bid.high, 0) &&
    typeof bid.basis === "string" &&
    ["pass", "fail", "needs_review"].includes(obj.overall) &&
    typeof obj.manager_review_required === "boolean" &&
    validStringArray(obj.manager_review_reasons, 12) &&
    validNumber(obj.confidence, 0, 1);
  if (!ok) throw new ModelOutputError("schema_mismatch");
}

// Coerce/validate the model object into the response schema. Fills safe
// defaults so the contract is always honored even if the model is sloppy.
function normalizeAssessment(obj, trade, phase, rubric) {
  requireModelShape(obj, trade, phase, rubric);
  const allowedViews = new Set(rubric.required_views || []);
  const allowedFamilies = new Set(rubric.equipment_families || ["unknown"]);
  const allowedModes = new Set(rubric.job_modes || ["unknown"]);
  const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);
  const clampViews = (arr) => Array.isArray(arr) ? [...new Set(arr.filter((v) => allowedViews.has(v)))] : [];
  const notApplicable = Array.isArray(obj.not_applicable_views)
    ? obj.not_applicable_views
        .filter((item) => item && allowedViews.has(item.view))
        .filter((item, index, all) => all.findIndex((other) => other.view === item.view) === index)
        .map((item) => ({ view: item.view, reason: clean(item.reason || "Not applicable to visible equipment/job mode.", 500) }))
    : [];
  const notApplicableNames = new Set(notApplicable.map((item) => item.view));
  const present = clampViews(obj.views_present).filter((view) => !notApplicableNames.has(view));
  const presentNames = new Set(present);
  const missing = [...allowedViews].filter((view) => !notApplicableNames.has(view) && !presentNames.has(view));

  const rawEquipment = obj.equipment || {};
  const family = allowedFamilies.has(rawEquipment.family) ? rawEquipment.family : "unknown";
  const jobMode = allowedModes.has(rawEquipment.job_mode) ? rawEquipment.job_mode : "unknown";
  const equipment = {
    family,
    job_mode: jobMode,
    nameplate_visible: rawEquipment.nameplate_visible === true,
    visible_nameplate_facts: Array.isArray(rawEquipment.visible_nameplate_facts)
      ? rawEquipment.visible_nameplate_facts.map((item) => clean(item, 300)).filter(Boolean).slice(0, 20)
      : [],
    reason: clean(rawEquipment.reason, 1000),
  };

  const sev = (s) => (["low", "med", "high"].includes(s) ? s : "med");
  const flags = Array.isArray(obj.safety_flags)
    ? obj.safety_flags.filter((f) => f && (f.issue || f.evidence)).slice(0, 20).map((f) => ({
        issue: clean(f.issue || "unspecified", 500),
        severity: sev(f.severity),
        evidence: clean(f.evidence, 1000),
      }))
    : [];

  const num = (v, d) => (typeof v === "number" && !Number.isNaN(v) ? v : d);
  const score = Math.max(0, Math.min(100, Math.round(num(obj.quality_score, 0))));
  const conf = Math.max(0, Math.min(1, num(obj.confidence, 0)));
  const managerReasons = Array.isArray(obj.manager_review_reasons)
    ? obj.manager_review_reasons.map((item) => clean(item, 500)).filter(Boolean).slice(0, 12)
    : [];
  const hasHigh = flags.some((f) => f.severity === "high");
  const unknownEquipment = family === "unknown" && allowedFamilies.size > 1;
  const managerReviewRequired = obj.manager_review_required === true || hasHigh || unknownEquipment || missing.length > 0 || managerReasons.length > 0;

  let overall = ["pass", "fail", "needs_review"].includes(obj.overall) ? obj.overall : "needs_review";
  if (hasHigh) overall = "fail";
  else if (managerReviewRequired && overall === "pass") overall = "needs_review";

  const bid = obj.bid_range || {};
  const pricingEnabled = Object.keys(rubric.bid_hint?.usd_broad_ranges || {}).length > 0;
  return {
    trade,
    phase,
    equipment,
    views_present: present,
    missing_views: missing,
    not_applicable_views: notApplicable,
    safety_flags: flags,
    quality_score: score,
    score_rationale: clean(obj.score_rationale, 1500),
    bid_range: {
      low: pricingEnabled ? Math.max(0, Math.round(num(bid.low, 0))) : 0,
      high: pricingEnabled ? Math.max(Math.max(0, Math.round(num(bid.low, 0))), Math.round(num(bid.high, 0))) : 0,
      basis: clean(bid.basis || "Draft only - shop owner must confirm before use.", 1000),
    },
    overall,
    manager_review_required: managerReviewRequired,
    manager_review_reasons: managerReasons,
    confidence: conf,
  };
}
// The main entry. store implements getPlan/getUsage/increment.
export async function handleScan(body, store, env) {
  const { userId, trade, phase, images } = body || {};

  // --- validation ---
  if (typeof userId !== "string" || !userId.trim() || userId.length > 128 || /[\x00-\x1f\x7f]/.test(userId))
    return { status: 400, body: { error: "invalid or missing userId" } };
  if (!trade || !RUBRICS[trade])
    return { status: 400, body: { error: "unknown or missing trade", supported: Object.keys(RUBRICS) } };
  if (!VALID_PHASES.has(phase))
    return { status: 400, body: { error: "phase must be before|during|after" } };
  try {
    validateImageSources(images, env);
  } catch (error) {
    const code = error instanceof VisionInputError ? error.code : "invalid_images";
    return { status: 400, body: { error: "invalid_images", reason: code } };
  }

  const rubric = RUBRICS[trade];
  const period = currentPeriod();
  const normalizedUserId = userId.trim();
  const scanKey = await buildScanCacheKey({ userId: normalizedUserId, trade, phase, images, env });

  // --- (1) METER CHECK — before any model spend ---
  const { allowed, metering, reserved } = await reserveScan(store, normalizedUserId, period);
  if (!allowed) {
    return {
      status: 402,
      body: { error: "quota_exceeded", metering, upgrade: true },
    };
  }

  // --- (2) call the vision model; only schema/JSON failures get one correction ---
  let assessment;
  let lastErr;
  const configuredAttempts = Number.parseInt(String(env?.FIELDSCAN_VISION_MAX_ATTEMPTS || "2"), 10);
  const maxAttempts = configuredAttempts === 1 ? 1 : 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const raw = await runVision({
        rubric,
        phase,
        images,
        env,
        retryFeedback: attempt > 0 ? lastErr?.code || "schema_mismatch" : "",
      });
      const parsed = extractJson(raw);
      assessment = normalizeAssessment(parsed, trade, phase, rubric);
      break;
    } catch (e) {
      lastErr = e;
      if (!(e instanceof ModelOutputError) || attempt + 1 >= maxAttempts) break;
    }
  }
  if (!assessment) {
    let failureMetering = metering;
    if (reserved) {
      try {
        await releaseScanReservation(store, normalizedUserId, period);
        failureMetering = {
          ...metering,
          used: Math.max(0, metering.used - 1),
          remaining: Math.min(metering.quota, metering.remaining + 1),
        };
      } catch { /* fail closed on quota */ }
    }
    if (lastErr instanceof VisionInputError) {
      return { status: 400, body: { error: "invalid_images", reason: lastErr.code, metering: failureMetering } };
    }
    const reason = lastErr instanceof ModelOutputError
      ? "invalid_model_output"
      : lastErr instanceof VisionProviderError
        ? lastErr.code
        : "provider_failed";
    return {
      status: 502,
      body: {
        error: "vision_failed",
        reason,
        provider: activeProvider(env),
        metering: failureMetering,
      },
    };
  }

  // --- (3) increment usage (only on success) ---
  const updated = reserved ? metering : await recordScan(store, normalizedUserId, period);

  // --- (4) return assessment WITH metering ---
  return {
    status: 200,
    body: { ...assessment, scan_key: scanKey, metering: updated },
  };
}

export { RUBRICS, normalizeAssessment };
