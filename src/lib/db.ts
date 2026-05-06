import { drizzle } from "drizzle-orm/d1";
import * as schema from "../schema";

/**
 * Initialize Drizzle ORM with the D1 binding from the Worker env.
 * Usage: const db = getDb(env);
 */
export function getDb(env: { DB: D1Database }) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;

// Re-export schema for convenience
export { schema };

// Re-export drizzle-orm utilities used across the app
export { eq, and, or, desc, asc, like, sql, count, gt, lt, gte, lte } from "drizzle-orm";
