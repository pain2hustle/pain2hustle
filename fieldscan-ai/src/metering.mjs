// Per-user scan metering. The founder's #1 requirement: cost can NEVER run
// away. Metering is checked BEFORE the model call. Over-quota => no model
// spend at all. Usage is incremented ONLY after a successful scan.

import plansJson from "../plans.json" with { type: "json" };

export function currentPeriod(date = new Date()) {
  // YYYY-MM in UTC.
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function resolvePlan(planName) {
  const fallback = plansJson._default || "starter";
  const plan = plansJson[planName] || plansJson[fallback];
  const quota = Number.isSafeInteger(plan?.quota) && plan.quota >= 0 ? plan.quota : 0;
  return { name: plansJson[planName] ? planName : fallback, ...plan, quota };
}

function usageCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function meter(plan, used, period) {
  const safeUsed = usageCount(used);
  return {
    plan: plan.name,
    used: safeUsed,
    quota: plan.quota,
    remaining: Math.max(0, plan.quota - safeUsed),
    period,
  };
}

// Reads the user's plan + usage and decides if they're allowed to scan.
// Returns { allowed, metering } where metering = {plan, used, quota, remaining, period}.
export async function checkQuota(store, userId, period = currentPeriod()) {
  const planName = await store.getPlan(userId);
  const plan = resolvePlan(planName);
  const used = usageCount(await store.getUsage(userId, period));
  const allowed = used < plan.quota;
  return {
    allowed,
    metering: meter(plan, used, period),
    reserved: false,
  };
}

// Call AFTER a successful scan. Returns refreshed metering.
export async function recordScan(store, userId, period = currentPeriod()) {
  const planName = await store.getPlan(userId);
  const plan = resolvePlan(planName);
  const used = usageCount(await store.increment(userId, period));
  return meter(plan, used, period);
}

// D1 can reserve atomically before model spend. Stores without reserve()
// retain the original check-before / increment-after contract.
export async function reserveScan(store, userId, period = currentPeriod()) {
  const planName = await store.getPlan(userId);
  const plan = resolvePlan(planName);
  if (plan.quota <= 0) {
    return { allowed: false, reserved: false, metering: meter(plan, 0, period) };
  }
  if (typeof store.reserve !== "function") return checkQuota(store, userId, period);
  const reservedCount = await store.reserve(userId, period, plan.quota);
  if (reservedCount !== null && reservedCount !== undefined) {
    return { allowed: true, reserved: true, metering: meter(plan, reservedCount, period) };
  }
  const used = usageCount(await store.getUsage(userId, period));
  return { allowed: false, reserved: false, metering: meter(plan, used, period) };
}

export async function releaseScanReservation(store, userId, period) {
  if (typeof store.refund === "function") await store.refund(userId, period);
}
