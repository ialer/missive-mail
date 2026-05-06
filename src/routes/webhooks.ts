import { Hono } from "hono";
import { z } from "zod";
import { getDb, schema, eq, and, sql } from "../lib/db";
import { generateId, hashApiKey, authMiddleware, type AuthVariables } from "../lib/auth";
import type { Env } from "../worker";

const webhookApp = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// All routes require authentication
webhookApp.use("*", authMiddleware());

// ─── Validation Schemas ──────────────────────────────────────────────────────
const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  filter: z.record(z.unknown()).optional(),
});

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  filter: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

// ─── GET /api/v1/webhooks ────────────────────────────────────────────────────
webhookApp.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const webhookList = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.userId, userId))
    .orderBy(sql`${schema.webhooks.createdAt} DESC`);

  // Don't expose secret_hash
  const safeWebhooks = webhookList.map(({ secretHash, ...rest }) => rest);

  return c.json({ webhooks: safeWebhooks });
});

// ─── POST /api/v1/webhooks ───────────────────────────────────────────────────
webhookApp.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const parsed = createWebhookSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.issues },
      400
    );
  }

  const db = getDb(c.env);
  const { url, events, filter } = parsed.data;

  // Generate webhook secret and hash it
  const secret = `whsec_${generateId()}${generateId()}`;
  const secretHash = await hashApiKey(secret);

  const id = generateId();
  const now = new Date();

  await db.insert(schema.webhooks).values({
    id,
    userId,
    url,
    events,
    filter: filter || null,
    secretHash,
    enabled: true,
    createdAt: now,
  });

  // Audit log
  await db.insert(schema.auditLogs).values({
    id: generateId(),
    userId,
    agentId: null,
    action: "webhook.create",
    details: { webhookUrl: url, events },
    ip: c.req.header("CF-Connecting-IP") || null,
    userAgent: c.req.header("User-Agent") || null,
    createdAt: now,
  });

  return c.json(
    {
      webhook: {
        id,
        url,
        events,
        filter,
        enabled: true,
        createdAt: now,
      },
      secret, // Only returned once — user must save it!
    },
    201
  );
});

// ─── GET /api/v1/webhooks/:id ────────────────────────────────────────────────
webhookApp.get("/:id", async (c) => {
  const userId = c.get("userId");
  const webhookId = c.req.param("id");
  const db = getDb(c.env);

  const webhooks = await db
    .select()
    .from(schema.webhooks)
    .where(
      and(eq(schema.webhooks.id, webhookId), eq(schema.webhooks.userId, userId))
    )
    .limit(1);

  if (webhooks.length === 0) {
    return c.json({ error: "Webhook not found" }, 404);
  }

  const { secretHash, ...safeWebhook } = webhooks[0];
  return c.json({ webhook: safeWebhook });
});

// ─── PUT /api/v1/webhooks/:id ────────────────────────────────────────────────
webhookApp.put("/:id", async (c) => {
  const userId = c.get("userId");
  const webhookId = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateWebhookSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.issues },
      400
    );
  }

  const db = getDb(c.env);

  // Verify ownership
  const existing = await db
    .select()
    .from(schema.webhooks)
    .where(
      and(eq(schema.webhooks.id, webhookId), eq(schema.webhooks.userId, userId))
    )
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Webhook not found" }, 404);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.url !== undefined) updates.url = parsed.data.url;
  if (parsed.data.events !== undefined) updates.events = parsed.data.events;
  if (parsed.data.filter !== undefined) updates.filter = parsed.data.filter;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;

  if (Object.keys(updates).length > 0) {
    await db
      .update(schema.webhooks)
      .set(updates)
      .where(eq(schema.webhooks.id, webhookId));
  }

  return c.json({ success: true });
});

// ─── DELETE /api/v1/webhooks/:id ─────────────────────────────────────────────
webhookApp.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const webhookId = c.req.param("id");
  const db = getDb(c.env);

  // Verify ownership
  const existing = await db
    .select()
    .from(schema.webhooks)
    .where(
      and(eq(schema.webhooks.id, webhookId), eq(schema.webhooks.userId, userId))
    )
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Webhook not found" }, 404);
  }

  await db.delete(schema.webhooks).where(eq(schema.webhooks.id, webhookId));

  // Audit log
  await db.insert(schema.auditLogs).values({
    id: generateId(),
    userId,
    agentId: null,
    action: "webhook.delete",
    details: { webhookUrl: existing[0].url },
    ip: c.req.header("CF-Connecting-IP") || null,
    userAgent: c.req.header("User-Agent") || null,
    createdAt: new Date(),
  });

  return c.json({ success: true });
});

// ─── POST /api/v1/webhooks/:id/test ──────────────────────────────────────────
webhookApp.post("/:id/test", async (c) => {
  const userId = c.get("userId");
  const webhookId = c.req.param("id");
  const db = getDb(c.env);

  // Verify ownership
  const webhooks = await db
    .select()
    .from(schema.webhooks)
    .where(
      and(eq(schema.webhooks.id, webhookId), eq(schema.webhooks.userId, userId))
    )
    .limit(1);

  if (webhooks.length === 0) {
    return c.json({ error: "Webhook not found" }, 404);
  }

  const webhook = webhooks[0];

  // Queue a test event
  await c.env.QUEUE.send({
    webhookId: webhook.id,
    event: "test",
    payload: {
      message: "This is a test webhook delivery",
      timestamp: new Date().toISOString(),
    },
  });

  return c.json({ message: "Test webhook queued" });
});

export { webhookApp as webhookRoutes };
