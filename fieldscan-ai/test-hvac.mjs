import assert from "node:assert/strict";
import { handleScan, RUBRICS } from "./src/scan.mjs";
import { createDevStore } from "./src/stores/dev.mjs";

const image = "data:image/jpeg;base64,/9j/aGVsbG8=";
assert.ok(RUBRICS.hvac);
assert.ok(RUBRICS.hvac.equipment_families.includes("packaged or rooftop unit"));
assert.ok(RUBRICS.hvac.equipment_families.includes("walk-in or reach-in cooler or freezer"));

const result = await handleScan(
  { userId: "hvac-test", trade: "hvac", phase: "after", images: [image] },
  createDevStore({ plans: { "hvac-test": "pro" } }),
  { FIELDSCAN_VISION_PROVIDER: "mock" }
);

assert.equal(result.status, 200);
assert.equal(result.body.trade, "hvac");
assert.ok(result.body.equipment);
assert.equal(result.body.manager_review_required, true);
assert.equal(result.body.overall, "needs_review");
assert.ok(result.body.views_present.every((view) => RUBRICS.hvac.required_views.includes(view)));
assert.equal(result.body.bid_range.low, 0);

console.log(JSON.stringify({ok:true,trade:result.body.trade,equipment:result.body.equipment.family,managerReviewRequired:result.body.manager_review_required},null,2));