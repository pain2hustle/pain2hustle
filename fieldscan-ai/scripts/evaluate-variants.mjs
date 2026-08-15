#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback;
};
const candidateRoot = valueAfter("--candidate", process.cwd());
const baselineRoot = valueAfter("--baseline", null);
const runTests = args.includes("--run-tests");

function text(root, relative) {
  try { return fs.readFileSync(path.join(root, relative), "utf8"); } catch { return ""; }
}

function allSource(root) {
  const files = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".wrangler" || entry.name === ".git") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/.(mjs|js|json|md|toml|sql)$/i.test(entry.name)) files.push(text(root, path.relative(root, absolute)));
    }
  };
  visit(root);
  return files.join(String.fromCharCode(10));
}

function check(id, pass, evidence) {
  return { id, pass: Boolean(pass), evidence };
}

function runVariantTests(root) {
  const files = ["test.mjs", "test-hvac.mjs", "test-agents.mjs", "test-runtime.mjs", "test-ui.mjs", "test-worker.mjs"]
    .filter((file) => fs.existsSync(path.join(root, file)));
  if (!files.length) return false;
  return files.every((file) => spawnSync(process.execPath, [file], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  }).status === 0);
}

function scoreVariant(root, label) {
  const index = text(root, "src/index.mjs");
  const scan = text(root, "src/scan.mjs");
  const vision = text(root, "src/vision.mjs");
  const metering = text(root, "src/metering.mjs");
  const d1 = text(root, "src/stores/d1.mjs");
  const packageJson = text(root, "package.json");
  const source = allSource(root);
  const testPass = runTests
    ? runVariantTests(root)
    : /test-agents.mjs/.test(packageJson) && /test-runtime.mjs/.test(packageJson);

  const groups = {
    correctness: [
      check("base-tests", /test.mjs/.test(packageJson), "package test entry"),
      check("full-tests-pass", testPass, runTests ? "npm test exit status" : "full suite registered"),
      check("strict-output-shape", /requireModelShape/.test(scan), "local schema gate"),
      check("deterministic-normalization", /normalizeAssessment/.test(scan), "normalization gate"),
      check("intent-compiler", /compileIntent/.test(source), "versioned task registry"),
      check("context-consolidation", /consolidateAgentResults/.test(source), "evidence ledger"),
      check("independent-grading", source.includes("selfAssessmentIsOfficial: false"), "self grade excluded"),
      check("plan-route", /pathname === "\/plan"/.test(index), "authenticated plan route"),
    ],
    safety: [
      check("auth-fail-closed", /!env.FIELDSCAN_AUTH_SECRET/.test(index), "missing auth secret returns an error"),
      check("image-count-bound", /maxImages/.test(vision) && /too_many_images/.test(vision), "image count limit"),
      check("image-byte-bound", /maxTotalImageBytes/.test(vision), "aggregate byte limit"),
      check("private-url-rejection", /isPrivateIpv4/.test(vision) && /localhost/.test(vision), "basic SSRF boundary"),
      check("api-key-header", /x-goog-api-key/.test(vision) && !vision.includes("?key="), "credential not in URL"),
      check("manager-review-gate", /hasHigh/.test(scan) && /managerReviewRequired/.test(scan), "high-risk deterministic gate"),
      check("secret-scanner", /assert-no-bundled-secrets/.test(packageJson), "predeploy secret scan"),
    ],
    evidence: [
      check("json-schema-output", /responseFormat/.test(vision) && /buildAssessmentJsonSchema/.test(vision), "provider schema"),
      check("required-evidence-ledger", /missingEvidence/.test(source), "explicit gaps"),
      check("fact-conflicts", /conflicts/.test(source), "conflict tracking"),
      check("evidence-references", /evidenceRefs/.test(source), "provenance references"),
      check("targeted-reread", /rereadRules/.test(source), "selective reread policy"),
    ],
    efficiency: [
      check("meter-before-model", scan.indexOf("reserveScan") >= 0 && scan.indexOf("reserveScan") < scan.indexOf("runVision"), "reservation precedes inference"),
      check("atomic-d1-reserve", d1.includes("WHERE usage.count < ? RETURNING count"), "conditional reservation"),
      check("bounded-retry", /maxAttempts/.test(scan) && /ModelOutputError/.test(scan), "only output repair retries"),
      check("content-key", /SHA-256/.test(vision) && /promptVersion/.test(vision), "versioned opaque key"),
      check("minimal-context-contract", /maxTokens/.test(source) && /inputRefs/.test(source), "bounded plan contract"),
    ],
    recovery: [
      check("reservation-refund", /releaseScanReservation/.test(metering) && /releaseScanReservation/.test(scan), "failed inference refund"),
      check("safe-provider-errors", /VisionProviderError/.test(scan) && /provider_request_failed/.test(vision), "normalized error codes"),
      check("targeted-correction", /CORRECTION:/.test(vision), "schema repair feedback"),
      check("runtime-tests", /test-runtime.mjs/.test(packageJson), "failure-path suite"),
      check("observability", /[observability]/.test(text(root, "wrangler.toml")), "Worker observability enabled"),
    ],
    usability: [
      check("grade-card", /renderAgentGradeCard/.test(source), "accessible grade component"),
      check("grade-endpoint", /pathname === "\/grade"/.test(index), "JSON/HTML grade route"),
      check("architecture-docs", /FieldScan agent architecture/.test(source), "agent contract documentation"),
      check("evolution-ledger", /Evolution ledger/.test(source), "adopt/cut/defer log"),
    ],
  };

  const weights = { correctness: 0.30, safety: 0.25, evidence: 0.15, efficiency: 0.15, recovery: 0.10, usability: 0.05 };
  const components = {};
  let total = 0;
  for (const [name, checks] of Object.entries(groups)) {
    const component = Number((10 * checks.filter((item) => item.pass).length / checks.length).toFixed(2));
    components[name] = { score: component, checks };
    total += component * weights[name];
  }
  const hardGates = {
    authenticationFailClosed: groups.safety[0].pass,
    highSeverityCannotPass: groups.safety[5].pass,
    boundedImagesBeforeModel: groups.safety[1].pass && groups.safety[2].pass,
    noBundledCredentialPattern: !/(AIza[0-9A-Za-z_-]{30,}|sk-[0-9A-Za-z_-]{20,})/.test(source),
    verificationPasses: testPass,
  };
  return {
    label,
    root,
    score: Number(total.toFixed(2)),
    hardGates,
    hardGatesPass: Object.values(hardGates).every(Boolean),
    components,
  };
}

const candidate = scoreVariant(candidateRoot, "candidate");
const baseline = baselineRoot ? scoreVariant(baselineRoot, "baseline") : null;
const baselineScore = baseline?.score ?? candidate.score;
const requestedTarget = Number((baselineScore + (baselineScore <= 6 ? 4.2 : 2.4)).toFixed(2));
const achievableTarget = Math.min(10, requestedTarget);

console.log(JSON.stringify({
  evaluationVersion: "fieldscan-eval-v1",
  runTests,
  rule: baselineScore <= 6 ? "baseline <= 6.0: +4.2" : "baseline > 6.0: +2.4",
  baseline,
  candidate,
  requestedTarget,
  achievableTarget,
  delta: baseline ? Number((candidate.score - baseline.score).toFixed(2)) : null,
  targetMet: candidate.hardGatesPass && candidate.score >= achievableTarget,
}, null, 2));
