// Vision provider abstraction. Env-switchable via FIELDSCAN_VISION_PROVIDER.
//   gemini  -> Google AI Studio Gemini Flash (PRODUCTION / default)
//   ollama  -> local gemma3:4b (DEV ONLY: slow + weak, proves the pipeline)
//
// Both providers receive the same prompt (built from the rubric) and the same
// set of images, and both are forced to return JSON. The caller handles
// schema validation + one retry.

import { buildScanPrompt } from "./prompt.mjs";

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
const DEFAULT_MAX_IMAGES = 12;
const DEFAULT_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_IMAGE_BYTES = 16 * 1024 * 1024;

export class VisionInputError extends Error {
  constructor(code) {
    super(code);
    this.name = "VisionInputError";
    this.code = code;
  }
}

export class VisionProviderError extends Error {
  constructor(code) {
    super(code);
    this.name = "VisionProviderError";
    this.code = code;
  }
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function imageLimits(env = {}) {
  const maxImages = boundedInteger(env.FIELDSCAN_MAX_IMAGES, DEFAULT_MAX_IMAGES, 1, 32);
  const maxImageBytes = boundedInteger(env.FIELDSCAN_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES, 1024, 20 * 1024 * 1024);
  const maxTotalImageBytes = boundedInteger(
    env.FIELDSCAN_MAX_TOTAL_IMAGE_BYTES,
    DEFAULT_MAX_TOTAL_IMAGE_BYTES,
    maxImageBytes,
    20 * 1024 * 1024
  );
  return { maxImages, maxImageBytes, maxTotalImageBytes };
}

function parseDataImage(src, maxImageBytes) {
  const match = /^data:(image\/(?:png|jpeg|webp|heic|heif));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(src);
  if (!match || match[2].length % 4 !== 0) throw new VisionInputError("invalid_image_data_uri");
  const base64 = match[2];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = (base64.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new VisionInputError("empty_image");
  if (bytes > maxImageBytes) throw new VisionInputError("image_too_large");
  try { atob(base64); } catch { throw new VisionInputError("invalid_image_base64"); }
  return { kind: "inline", mime: match[1].toLowerCase(), base64, bytes };
}

function isPrivateIpv4(hostname) {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function inspectImageSource(src, maxImageBytes) {
  if (typeof src !== "string" || !src) throw new VisionInputError("invalid_image_source");
  if (src.startsWith("data:")) return parseDataImage(src, maxImageBytes);
  let url;
  try { url = new URL(src); } catch { throw new VisionInputError("invalid_image_url"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || !host || host === "localhost" ||
      host.endsWith(".localhost") || host.endsWith(".local") || host === "[::1]" ||
      host.startsWith("[fe80:") || isPrivateIpv4(host)) {
    throw new VisionInputError("invalid_image_url");
  }
  return { kind: "remote", url: url.href, bytes: 0 };
}

export function validateImageSources(images, env = {}) {
  const limits = imageLimits(env);
  if (!Array.isArray(images) || images.length === 0) throw new VisionInputError("images_required");
  if (images.length > limits.maxImages) throw new VisionInputError("too_many_images");
  const inspected = images.map((src) => inspectImageSource(src, limits.maxImageBytes));
  const inlineBytes = inspected.reduce((sum, item) => sum + item.bytes, 0);
  if (inlineBytes > limits.maxTotalImageBytes) throw new VisionInputError("images_too_large");
  return { inspected, inlineBytes, ...limits };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function readBoundedBody(response, limit) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new VisionInputError("image_too_large");
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new VisionInputError("image_too_large");
    return bytes;
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new VisionInputError("image_too_large");
      chunks.push(value);
    }
  } finally {
    if (total > limit) await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function toInlineImage(src, budget) {
  const inspected = inspectImageSource(src, budget.maxImageBytes);
  if (inspected.kind === "inline") {
    budget.used += inspected.bytes;
    if (budget.used > budget.maxTotalImageBytes) throw new VisionInputError("images_too_large");
    return inspected;
  }
  let response;
  try { response = await fetch(inspected.url, { redirect: "error" }); }
  catch { throw new VisionInputError("image_fetch_failed"); }
  if (!response.ok) throw new VisionInputError("image_fetch_failed");
  const mime = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!IMAGE_MIME_TYPES.has(mime)) throw new VisionInputError("unsupported_image_type");
  const remaining = Math.min(budget.maxImageBytes, budget.maxTotalImageBytes - budget.used);
  if (remaining <= 0) throw new VisionInputError("images_too_large");
  const bytes = await readBoundedBody(response, remaining);
  if (!bytes.byteLength) throw new VisionInputError("empty_image");
  budget.used += bytes.byteLength;
  return { mime, base64: bytesToBase64(bytes), bytes: bytes.byteLength };
}

export function buildAssessmentJsonSchema(rubric, phase) {
  const views = rubric.required_views || [];
  const families = rubric.equipment_families?.length ? rubric.equipment_families : ["unknown"];
  const modes = rubric.job_modes?.length ? rubric.job_modes : ["unknown"];
  const stringArray = (maxItems = 20) => ({ type: "array", maxItems, items: { type: "string" } });
  const viewArray = { type: "array", maxItems: views.length, items: { type: "string", enum: views } };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      trade: { type: "string", enum: [rubric.trade] },
      phase: { type: "string", enum: [phase] },
      equipment: {
        type: "object",
        additionalProperties: false,
        properties: {
          family: { type: "string", enum: families },
          job_mode: { type: "string", enum: modes },
          nameplate_visible: { type: "boolean" },
          visible_nameplate_facts: stringArray(20),
          reason: { type: "string" },
        },
        required: ["family", "job_mode", "nameplate_visible", "visible_nameplate_facts", "reason"],
      },
      views_present: viewArray,
      missing_views: viewArray,
      not_applicable_views: {
        type: "array",
        maxItems: views.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: { view: { type: "string", enum: views }, reason: { type: "string" } },
          required: ["view", "reason"],
        },
      },
      safety_flags: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            issue: { type: "string" },
            severity: { type: "string", enum: ["low", "med", "high"] },
            evidence: { type: "string" },
          },
          required: ["issue", "severity", "evidence"],
        },
      },
      quality_score: { type: "number", minimum: 0, maximum: 100 },
      score_rationale: { type: "string" },
      bid_range: {
        type: "object",
        additionalProperties: false,
        properties: {
          low: { type: "number", minimum: 0 },
          high: { type: "number", minimum: 0 },
          basis: { type: "string" },
        },
        required: ["low", "high", "basis"],
      },
      overall: { type: "string", enum: ["pass", "fail", "needs_review"] },
      manager_review_required: { type: "boolean" },
      manager_review_reasons: stringArray(12),
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: [
      "trade", "phase", "equipment", "views_present", "missing_views", "not_applicable_views",
      "safety_flags", "quality_score", "score_rationale", "bid_range", "overall",
      "manager_review_required", "manager_review_reasons", "confidence",
    ],
  };
}

async function normalizedImages(images, env) {
  const checked = validateImageSources(images, env);
  const budget = {
    used: 0,
    maxImageBytes: checked.maxImageBytes,
    maxTotalImageBytes: checked.maxTotalImageBytes,
  };
  const result = [];
  for (const src of images) result.push(await toInlineImage(src, budget));
  return result;
}

// ---- providers -----------------------------------------------------------

async function callGemini({ prompt, rubric, phase, images, env }) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new VisionProviderError("provider_not_configured");
  const model = env.GEMINI_MODEL || "gemini-3.6-flash";
  if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new VisionProviderError("invalid_model_config");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const parts = [{ text: prompt }];
  for (const image of await normalizedImages(images, env)) {
    parts.push({ inlineData: { mimeType: image.mime, data: image.base64 } });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseFormat: {
        text: {
          mimeType: "application/json",
          schema: buildAssessmentJsonSchema(rubric, phase),
        },
      },
    },
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
  } catch {
    throw new VisionProviderError("provider_unavailable");
  }
  if (!res.ok) throw new VisionProviderError("provider_request_failed");
  let json;
  try { json = await res.json(); }
  catch { throw new VisionProviderError("provider_invalid_response"); }
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  if (!text) throw new VisionProviderError("provider_empty_response");
  return text;
}

async function callOllama({ prompt, images, env }) {
  let host;
  try { host = new URL(env.OLLAMA_HOST || "http://localhost:11434"); }
  catch { throw new VisionProviderError("invalid_provider_config"); }
  if (!new Set(["http:", "https:"]).has(host.protocol) || host.username || host.password) {
    throw new VisionProviderError("invalid_provider_config");
  }
  const model = env.OLLAMA_MODEL || "gemma3:4b";

  // Ollama wants raw base64 (no data: prefix) in images[].
  const b64images = (await normalizedImages(images, env)).map((image) => image.base64);

  const body = {
    model,
    prompt,
    images: b64images,
    format: "json",
    stream: false,
  };

  let res;
  try {
    res = await fetch(new URL("/api/generate", host), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new VisionProviderError("provider_unavailable");
  }
  if (!res.ok) throw new VisionProviderError("provider_request_failed");
  let json;
  try { json = await res.json(); }
  catch { throw new VisionProviderError("provider_invalid_response"); }
  if (typeof json.response !== "string" || !json.response) {
    throw new VisionProviderError("provider_empty_response");
  }
  return json.response;
}

// ---- mock provider (tests only) -----------------------------------------
// Returns canned valid JSON and counts invocations so tests can PROVE the
// model was (or was not) called. Never used in production.
export const __mock = { calls: 0, responses: [], prompts: [] };

async function callMock({ rubric, phase, prompt }) {
  __mock.calls++;
  __mock.prompts.push(prompt);
  if (__mock.responses.length) {
    const response = __mock.responses.shift();
    if (response instanceof Error) throw response;
    return typeof response === "string" ? response : JSON.stringify(response);
  }
  return JSON.stringify({
    trade: rubric.trade,
    phase,
    equipment: { family: rubric.equipment_families?.[0] || "unknown", job_mode: rubric.job_modes?.[0] || "unknown", nameplate_visible: false, visible_nameplate_facts: [], reason: "mock fixture" },
    views_present: rubric.required_views.slice(0, 3),
    missing_views: rubric.required_views.slice(3),
    not_applicable_views: [],
    safety_flags: [
      { issue: "cable shows minor fraying", severity: "med", evidence: "left cable near drum" },
    ],
    quality_score: 72,
    score_rationale: "Good coverage of core components; missing safety-test evidence.",
    bid_range: { low: 200, high: 500, basis: "spring pair — owner must confirm" },
    overall: "needs_review",
    manager_review_required: true,
    manager_review_reasons: ["Incomplete required evidence"],
    confidence: 0.6,
  });
}

// ---- public API ----------------------------------------------------------

export function activeProvider(env = {}) {
  const provider = String(env.FIELDSCAN_VISION_PROVIDER || "gemini").toLowerCase();
  return new Set(["gemini", "ollama", "mock"]).has(provider) ? provider : "unknown";
}

// Returns the RAW text output of the model (expected to be JSON).
export async function runVision({ rubric, phase, images, env = {}, retryFeedback = "" }) {
  validateImageSources(images, env);
  const correction = retryFeedback
    ? `\n\nCORRECTION: Your previous response failed local schema validation (${retryFeedback}). Return one complete JSON object matching the schema exactly.`
    : "";
  const prompt = buildScanPrompt(rubric, phase) + correction;
  const provider = activeProvider(env);
  if (provider === "gemini") return callGemini({ prompt, rubric, phase, images, env });
  if (provider === "ollama") return callOllama({ prompt, images, env });
  if (provider === "mock") return callMock({ rubric, phase, prompt });
  throw new VisionProviderError("unknown_provider");
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Stable helper for idempotency/cache lookup. No image data appears in the key.
export async function buildScanCacheKey({ userId, trade, phase, images, env = {} }) {
  validateImageSources(images, env);
  const material = JSON.stringify({
    version: "fieldscan-cache-v1",
    userId: String(userId || ""),
    trade: String(trade || ""),
    phase: String(phase || ""),
    model: env.GEMINI_MODEL || "gemini-3.6-flash",
    rubricVersion: String(env.FIELDSCAN_RUBRIC_VERSION || "1"),
    promptVersion: String(env.FIELDSCAN_PROMPT_VERSION || "1"),
    images,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return `scan:v1:${hex(new Uint8Array(digest))}`;
}
