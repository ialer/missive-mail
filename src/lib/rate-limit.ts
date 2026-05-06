/**
 * KV-based sliding window rate limiter.
 *
 * Uses Cloudflare KV to store request counts in a fixed-size sliding
 * window.  Each window is a separate KV key with an expiration TTL.
 * Supports both IP-level and user-level limiting.
 *
 * Usage:
 *   const allowed = await checkRateLimit(env, `ip:${clientIp}`, 100, 60);
 *   const allowed = await checkRateLimit(env, `user:${userId}`, 200, 3600);
 */

import type { Env } from "../worker";

interface WindowEntry {
  count: number;
  windowStart: number;
}

/**
 * Check and increment a rate-limit counter for the given key.
 *
 * @param env          Worker environment (needs KV binding)
 * @param key          Rate-limit key, e.g. "ip:1.2.3.4" or "user:abc123"
 * @param limit        Max requests allowed in the window
 * @param windowSeconds Length of the sliding window in seconds
 * @returns `true` if the request is allowed, `false` if rate-limited
 */
export async function checkRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const now = Date.now();
  const kvKey = `ratelimit:${key}`;

  // Read current window
  const raw = await env.KV.get<WindowEntry>(kvKey, { type: "json" });

  let entry: WindowEntry;

  if (!raw || now - raw.windowStart > windowSeconds * 1000) {
    // Window expired or doesn't exist — start a new one
    entry = { count: 1, windowStart: now };
  } else if (raw.count >= limit) {
    // Rate limit exceeded
    return false;
  } else {
    entry = { count: raw.count + 1, windowStart: raw.windowStart };
  }

  // Write back with TTL matching the window
  await env.KV.put(kvKey, JSON.stringify(entry), {
    expirationTtl: windowSeconds + 60, // 1 min buffer for clock drift
  });

  return true;
}

/**
 * Get the current remaining quota for a key.
 * Useful for returning rate-limit headers (X-RateLimit-Remaining, etc.)
 */
export async function getRateLimitInfo(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ remaining: number; resetsAt: number }> {
  const now = Date.now();
  const kvKey = `ratelimit:${key}`;

  const raw = await env.KV.get<WindowEntry>(kvKey, { type: "json" });

  if (!raw || now - raw.windowStart > windowSeconds * 1000) {
    return { remaining: limit, resetsAt: now + windowSeconds * 1000 };
  }

  return {
    remaining: Math.max(0, limit - raw.count),
    resetsAt: raw.windowStart + windowSeconds * 1000,
  };
}
