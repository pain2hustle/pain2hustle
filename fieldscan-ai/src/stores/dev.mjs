// Dev / local usage store. Two flavors behind one interface:
//   - in-memory Map (default, great for tests)
//   - JSON file (set opts.file to persist across runs)
//
// Interface (shared by all stores):
//   getPlan(userId)            -> plan name string
//   getUsage(userId, period)   -> integer count for that YYYY-MM period
//   increment(userId, period)  -> new integer count
//
// Plans/quotas live in plans.json and are resolved by metering.mjs, not here.
// A store only needs to know each user's PLAN NAME and their COUNT per period.

import fs from "node:fs";

export function createDevStore(opts = {}) {
  const file = opts.file || null;
  const defaultPlan = opts.defaultPlan || "starter";

  // shape: { plans: { userId: planName }, usage: { "userId|period": count } }
  let state = { plans: {}, usage: {} };

  if (file && fs.existsSync(file)) {
    try {
      state = JSON.parse(fs.readFileSync(file, "utf8"));
      state.plans = state.plans || {};
      state.usage = state.usage || {};
    } catch {
      state = { plans: {}, usage: {} };
    }
  }
  // seed plans passed in explicitly (e.g. from tests)
  if (opts.plans) Object.assign(state.plans, opts.plans);

  function persist() {
    if (file) fs.writeFileSync(file, JSON.stringify(state, null, 2));
  }
  const key = (u, p) => `${u}|${p}`;

  return {
    kind: "dev",
    async getPlan(userId) {
      return state.plans[userId] || defaultPlan;
    },
    async setPlan(userId, plan) {
      state.plans[userId] = plan;
      persist();
    },
    async getUsage(userId, period) {
      return state.usage[key(userId, period)] || 0;
    },
    async increment(userId, period) {
      const k = key(userId, period);
      state.usage[k] = (state.usage[k] || 0) + 1;
      persist();
      return state.usage[k];
    },
    // test helper
    _dump() {
      return JSON.parse(JSON.stringify(state));
    },
  };
}
