// Production usage store backed by Cloudflare KV.
// Used when the account/token can do KV but not D1. Same interface as the dev
// and D1 stores: getPlan / setPlan / getUsage / increment.
//
// `kv` is env.USAGE_KV (a KVNamespace, bound in wrangler.toml).
// Keys:  plan:<userId>            -> plan name (string)
//        usage:<userId>:<period>  -> scans this period (stringified int)
//
// NOTE: KV is eventually-consistent and increment is read-then-write (not atomic),
// so two truly-simultaneous scans for the same user could under-count by 1. That
// is acceptable for metering — it can only ever let a hair MORE through, never
// over-charge, and per-user concurrency is realistically ~1 (a tech uploads a
// packet, not a thundering herd).
export function createKvStore(kv, opts = {}) {
  const defaultPlan = opts.defaultPlan || "starter";
  if (!kv) throw new Error("createKvStore: missing KV binding (env.USAGE_KV)");

  const keyPart = (value, label) => {
    const part = String(value || "");
    if (!part || part.length > 128 || /[\x00-\x1f\x7f]/.test(part)) {
      throw new Error(`invalid ${label}`);
    }
    return part;
  };
  const planKey = (u) => `plan:${keyPart(u, "userId")}`;
  const usageKey = (u, p) => `usage:${keyPart(u, "userId")}:${keyPart(p, "period")}`;

  const store = {
    kind: "kv",

    async getPlan(userId) {
      return (await kv.get(planKey(userId))) || defaultPlan;
    },

    async setPlan(userId, plan) {
      await kv.put(planKey(userId), String(plan));
    },

    async getUsage(userId, period) {
      const v = await kv.get(usageKey(userId, period));
      const count = Number.parseInt(v || "0", 10);
      return Number.isSafeInteger(count) && count >= 0 ? count : 0;
    },

    async increment(userId, period) {
      const next = (await store.getUsage(userId, period)) + 1;
      // 40-day TTL: an old month's counter self-expires so the namespace stays tidy.
      await kv.put(usageKey(userId, period), String(next), {
        expirationTtl: 60 * 60 * 24 * 40,
      });
      return next;
    },
  };

  return store;
}
