// Production usage store backed by Cloudflare D1.
// Same interface as the dev store: getPlan / getUsage / increment.
//
// Requires a D1 binding named DB (see wrangler.toml) and the schema in
// schema.sql applied. `db` is env.DB (a D1Database) passed in by the worker.
//
// Tables:
//   users(user_id TEXT PRIMARY KEY, plan TEXT NOT NULL)
//   usage(user_id TEXT, period TEXT, count INTEGER, PRIMARY KEY(user_id, period))

export function createD1Store(db, opts = {}) {
  const defaultPlan = opts.defaultPlan || "starter";
  if (!db) throw new Error("createD1Store: missing D1 binding (env.DB)");

  return {
    kind: "d1",

    async getPlan(userId) {
      const row = await db
        .prepare("SELECT plan FROM users WHERE user_id = ?")
        .bind(userId)
        .first();
      return row?.plan || defaultPlan;
    },

    async setPlan(userId, plan) {
      await db
        .prepare(
          "INSERT INTO users (user_id, plan) VALUES (?, ?) " +
            "ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan"
        )
        .bind(userId, plan)
        .run();
    },

    async getUsage(userId, period) {
      const row = await db
        .prepare("SELECT count FROM usage WHERE user_id = ? AND period = ?")
        .bind(userId, period)
        .first();
      return row?.count || 0;
    },

    // Atomic upsert-and-increment; returns the new count.
    async increment(userId, period) {
      const row = await db
        .prepare(
          "INSERT INTO usage (user_id, period, count) VALUES (?, ?, 1) " +
            "ON CONFLICT(user_id, period) DO UPDATE SET count = usage.count + 1 " +
            "RETURNING count"
        )
        .bind(userId, period)
        .first();
      return Number.isSafeInteger(row?.count) ? row.count : 0;
    },

    // One SQL statement closes the check/increment race. A null row means the
    // quota was already exhausted. The caller refunds on failed inference.
    async reserve(userId, period, quota) {
      if (!Number.isSafeInteger(quota) || quota <= 0) return null;
      const reserved = await db
        .prepare(
          "INSERT INTO usage (user_id, period, count) VALUES (?, ?, 1) " +
            "ON CONFLICT(user_id, period) DO UPDATE SET count = usage.count + 1 " +
            "WHERE usage.count < ? RETURNING count"
        )
        .bind(userId, period, quota)
        .first();
      return Number.isSafeInteger(reserved?.count) ? reserved.count : null;
    },

    async refund(userId, period) {
      await db
        .prepare(
          "UPDATE usage SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END " +
            "WHERE user_id = ? AND period = ?"
        )
        .bind(userId, period)
        .run();
    },
  };
}
