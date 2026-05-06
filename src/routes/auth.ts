import { Hono } from "hono";
import { z } from "zod";
import { getDb, schema, eq, like } from "../lib/db";
import {
  generateId,
  hashPassword,
  comparePassword,
  signJwt,
  verifyJwt,
  authMiddleware,
  type AuthVariables,
} from "../lib/auth";
import { verifyTurnstile } from "../lib/turnstile";
import type { Env } from "../worker";

const authApp = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// ─── Validation Schemas ──────────────────────────────────────────────────────
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100).optional(),
  turnstileToken: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  turnstileToken: z.string().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

// ─── POST /auth/register ─────────────────────────────────────────────────────
authApp.post("/register", async (c) => {
  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const { email, password, name, turnstileToken } = parsed.data;
  const db = getDb(c.env);

  // Verify Turnstile (optional if token provided)
  if (turnstileToken) {
    const ok = await verifyTurnstile(c.env, turnstileToken, c.req.header("cf-connecting-ip") || "unknown");
    if (!ok) return c.json({ error: "Captcha verification failed" }, 403);
  }

  // Check if user already exists
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);

  if (existing.length > 0) {
    return c.json({ error: "Email already registered" }, 409);
  }

  const id = generateId();
  const passwordHash = await hashPassword(password);
  const now = new Date();

  await db
    .insert(schema.users)
    .values({
      id,
      email: email.toLowerCase(),
      passwordHash,
      name,
      totpEnabled: false,
      createdAt: now,
      updatedAt: now,
    });

  // Generate tokens
  const secret = c.env.JWT_SECRET || "dev-secret-change-me";
  const accessToken = await signJwt(
    { sub: id, email: email.toLowerCase(), type: "access" },
    secret,
    60 * 60 * 1000 // 1 hour
  );
  const refreshToken = await signJwt(
    { sub: id, email: email.toLowerCase(), type: "refresh" },
    secret,
    7 * 24 * 60 * 60 * 1000 // 7 days
  );

  // Store refresh token in KV for revocation
  await c.env.KV.put(`refresh:${id}:${refreshToken.slice(-20)}`, "active", {
    expirationTtl: 7 * 24 * 60 * 60,
  });

  // Register email address in KV for incoming mail routing
  await c.env.KV.put(`email:${email.toLowerCase()}`, id);

  return c.json(
    {
      user: { id, email: email.toLowerCase(), name },
      accessToken,
      refreshToken,
    },
    201
  );
});

// ─── POST /auth/login ────────────────────────────────────────────────────────
authApp.post("/login", async (c) => {
  const body = await c.req.json();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const { email, password, turnstileToken } = parsed.data;
  const db = getDb(c.env);

  // Verify Turnstile (optional if token provided)
  if (turnstileToken) {
    const ok = await verifyTurnstile(c.env, turnstileToken, c.req.header("cf-connecting-ip") || "unknown");
    if (!ok) return c.json({ error: "Captcha verification failed" }, 403);
  }
  const ip =
    c.req.header("CF-Connecting-IP") || c.req.header("x-forwarded-for") || "unknown";
  const userAgent = c.req.header("User-Agent") || "unknown";

  // Find user
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);

  if (users.length === 0) {
    // Log failed attempt
    await db.insert(schema.loginHistory).values({
      id: generateId(),
      userId: "unknown",
      ip,
      userAgent,
      success: false,
      failureReason: "user_not_found",
      createdAt: new Date(),
    });
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const user = users[0];
  const passwordValid = await comparePassword(password, user.passwordHash);

  if (!passwordValid) {
    await db.insert(schema.loginHistory).values({
      id: generateId(),
      userId: user.id,
      ip,
      userAgent,
      success: false,
      failureReason: "wrong_password",
      createdAt: new Date(),
    });
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // If 2FA is enabled, require TOTP verification
  if (user.totpEnabled) {
    return c.json(
      {
        requiresTwoFactor: true,
        message: "Please provide TOTP code",
        tempToken: await signJwt(
          { sub: user.id, email: user.email, type: "access" },
          c.env.JWT_SECRET || "dev-secret-change-me",
          5 * 60 * 1000 // 5 minutes
        ),
      },
      200
    );
  }

  // Generate tokens
  const secret = c.env.JWT_SECRET || "dev-secret-change-me";
  const accessToken = await signJwt(
    { sub: user.id, email: user.email, type: "access" },
    secret,
    60 * 60 * 1000
  );
  const refreshToken = await signJwt(
    { sub: user.id, email: user.email, type: "refresh" },
    secret,
    7 * 24 * 60 * 60 * 1000
  );

  // Store refresh token
  await c.env.KV.put(`refresh:${user.id}:${refreshToken.slice(-20)}`, "active", {
    expirationTtl: 7 * 24 * 60 * 60,
  });

  // Log successful login
  await db.insert(schema.loginHistory).values({
    id: generateId(),
    userId: user.id,
    ip,
    userAgent,
    success: true,
    failureReason: null,
    createdAt: new Date(),
  });

  return c.json({
    user: { id: user.id, email: user.email, name: user.name },
    accessToken,
    refreshToken,
  });
});

// ─── POST /auth/logout ───────────────────────────────────────────────────────
authApp.post("/logout", authMiddleware(), async (c) => {
  const userId = c.get("userId");
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.slice(7) || "";

  // Revoke all refresh tokens from KV
  const list = await c.env.KV.list({ prefix: `refresh:${userId}:` });
  for (const key of list.keys) {
    await c.env.KV.delete(key.name);
  }

  // Store the access token in a denylist with TTL
  if (token) {
    const payload = await verifyJwt(
      token,
      c.env.JWT_SECRET || "dev-secret-change-me"
    );
    if (payload) {
      const ttl = payload.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await c.env.KV.put(`revoked:${token.slice(-20)}`, "1", {
          expirationTtl: ttl,
        });
      }
    }
  }

  return c.json({ message: "Logged out successfully" });
});

// ─── POST /auth/refresh ──────────────────────────────────────────────────────
authApp.post("/refresh", async (c) => {
  const body = await c.req.json();
  const parsed = refreshSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Validation failed" }, 400);
  }

  const { refreshToken } = parsed.data;
  const secret = c.env.JWT_SECRET || "dev-secret-change-me";
  const payload = await verifyJwt(refreshToken, secret);

  if (!payload || payload.type !== "refresh") {
    return c.json({ error: "Invalid refresh token" }, 401);
  }

  // Check if refresh token is still in KV
  const stored = await c.env.KV.get(
    `refresh:${payload.sub}:${refreshToken.slice(-20)}`
  );
  if (!stored) {
    return c.json({ error: "Refresh token has been revoked" }, 401);
  }

  // Delete old refresh token
  await c.env.KV.delete(`refresh:${payload.sub}:${refreshToken.slice(-20)}`);

  // Issue new tokens
  const newAccessToken = await signJwt(
    { sub: payload.sub, email: payload.email, type: "access" },
    secret,
    60 * 60 * 1000
  );
  const newRefreshToken = await signJwt(
    { sub: payload.sub, email: payload.email, type: "refresh" },
    secret,
    7 * 24 * 60 * 60 * 1000
  );

  // Store new refresh token
  await c.env.KV.put(
    `refresh:${payload.sub}:${newRefreshToken.slice(-20)}`,
    "active",
    { expirationTtl: 7 * 24 * 60 * 60 }
  );

  return c.json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  });
});

// ─── GET /auth/me ────────────────────────────────────────────────────────────
authApp.get("/me", authMiddleware(), async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      totpEnabled: schema.users.totpEnabled,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (users.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user: users[0] });
});

export { authApp as authRoutes };
