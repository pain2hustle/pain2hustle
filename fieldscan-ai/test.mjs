// FieldScan AI — real tests. Calls the handler directly (no live deploy).
//
//   node test.mjs            -> metering test (fast, mock provider)
//   node test.mjs vision     -> real ollama/gemma3 vision test on gd_small.jpg
//   node test.mjs all        -> both
//
import fs from "node:fs";
import { handleScan } from "./src/scan.mjs";
import { createDevStore } from "./src/stores/dev.mjs";
import { __mock } from "./src/vision.mjs";
import { currentPeriod, checkQuota } from "./src/metering.mjs";

const IMG =
  "C:\\Users\\Servi\\AppData\\Local\\Temp\\claude\\C--Users-Servi\\37c8a059-d545-478a-a945-5450e4428e27\\scratchpad\\gd_small.jpg";
const line = (s = "") => console.log(s);
const j = (o) => console.log(JSON.stringify(o, null, 2));

const DUMMY_IMG = "data:image/jpeg;base64,/9j/aGVsbG8="; // mock ignores content

// -------------------------------------------------------------------------
async function meteringTest() {
  line("========================================================");
  line("TEST 1 — METERING (mock provider; quota enforced BEFORE model)");
  line("  user 'techA' is on the 'test' plan (quota = 3).");
  line("========================================================");

  const env = { FIELDSCAN_VISION_PROVIDER: "mock" };
  const store = createDevStore({ plans: { techA: "test" } });
  const req = () => ({ userId: "techA", trade: "garage-doors", phase: "after", images: [DUMMY_IMG] });

  __mock.calls = 0;
  let blockedModelCalls = null;

  for (let i = 1; i <= 4; i++) {
    const res = await handleScan(req(), store, env);
    line(`\n-- scan attempt #${i}  (cumulative mock model calls: ${__mock.calls}) --`);
    line(`status: ${res.status}${res.status === 402 ? "  <= QUOTA_EXCEEDED" : ""}`);
    j(res.body.metering || res.body);
    if (res.status === 402) blockedModelCalls = __mock.calls;
  }

  line("\n--- assertions ---");
  const usageNow = await store.getUsage("techA", currentPeriod());
  const a1 = __mock.calls === 3;
  const a2 = blockedModelCalls === 3; // model NOT called on the blocked attempt
  const a3 = usageNow === 3; // blocked scan did not increment
  line(`[${a1 ? "PASS" : "FAIL"}] model called exactly 3 times (once per allowed scan): ${__mock.calls}`);
  line(`[${a2 ? "PASS" : "FAIL"}] model calls frozen at 3 when 4th was blocked (no spend over quota)`);
  line(`[${a3 ? "PASS" : "FAIL"}] usage count = 3 after block (blocked scan did NOT increment)`);

  // --- fresh-period reset (quota resets each YYYY-MM) ---
  line("\n--- fresh period reset ---");
  const p1 = currentPeriod();
  const p2 = "2099-01";
  const before = await checkQuota(store, "techA", p2);
  line(`current period ${p1}: used=3/3 (exhausted).`);
  line(`fresh period ${p2}: used=${before.metering.used}, remaining=${before.metering.remaining}, allowed=${before.allowed}`);
  const a4 = before.metering.used === 0 && before.allowed === true;
  line(`[${a4 ? "PASS" : "FAIL"}] new period resets quota (used=0, allowed again)`);

  line("\nMETERING TEST DONE.\n");
}

// -------------------------------------------------------------------------
async function visionTest() {
  line("========================================================");
  line("TEST 2 — VISION PIPELINE (real ollama/gemma3:4b on gd_small.jpg)");
  line("  NOTE: local 4B is slow (~100s) + weak. Proving pipeline + schema,");
  line("  NOT model quality. Gemini Flash in prod will be far better.");
  line("========================================================");

  if (!fs.existsSync(IMG)) {
    line(`IMAGE NOT FOUND: ${IMG}`);
    return;
  }
  const b64 = fs.readFileSync(IMG).toString("base64");
  const dataUri = `data:image/jpeg;base64,${b64}`;
  line(`image loaded: ${IMG} (${b64.length} b64 chars)`);

  const env = {
    FIELDSCAN_VISION_PROVIDER: "ollama",
    OLLAMA_MODEL: "gemma3:4b",
    OLLAMA_HOST: "http://localhost:11434",
  };
  const store = createDevStore({ plans: { techVision: "pro" } });

  const t0 = Date.now();
  const res = await handleScan(
    { userId: "techVision", trade: "garage-doors", phase: "after", images: [dataUri] },
    store,
    env
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  line(`\ninference took ${secs}s — HTTP status ${res.status}`);
  line("structured JSON response:");
  j(res.body);
  line("\nVISION TEST DONE.\n");
}

// -------------------------------------------------------------------------
const mode = process.argv[2] || "metering";
if (mode === "metering") await meteringTest();
else if (mode === "vision") await visionTest();
else if (mode === "all") {
  await meteringTest();
  await visionTest();
} else line(`unknown mode: ${mode} (use: metering | vision | all)`);
