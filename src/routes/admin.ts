import { Hono } from "hono";
import { z } from "zod";
import { getDb, schema, eq, and, sql } from "../lib/db";
import { generateId, hashPassword, comparePassword, authMiddleware, type AuthVariables } from "../lib/auth";
import type { Env } from "../worker";

const adminApp = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// All routes require authentication
adminApp.use("*", authMiddleware());

// ─── GET /api/v1/admin/overview ──────────────────────────────────────────────
adminApp.get("/overview", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  // Get user stats
  const totalMails = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.mails)
    .where(eq(schema.mails.userId, userId));

  const unreadMails = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.mails)
    .where(and(eq(schema.mails.userId, userId), eq(schema.mails.isRead, false)));

  const starredMails = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.mails)
    .where(and(eq(schema.mails.userId, userId), eq(schema.mails.isStarred, true)));

  const totalAttachments = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.attachments)
    .innerJoin(schema.mails, eq(schema.attachments.mailId, schema.mails.id))
    .where(eq(schema.mails.userId, userId));

  const activeAgents = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.agents)
    .where(and(eq(schema.agents.userId, userId), eq(schema.agents.enabled, true)));

  const activeWebhooks = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.webhooks)
    .where(
      and(eq(schema.webhooks.userId, userId), eq(schema.webhooks.enabled, true))
    );

  // Mails by folder
  const folderCounts = await db
    .select({
      folder: schema.mails.folder,
      count: sql<number>`count(*)`,
    })
    .from(schema.mails)
    .where(eq(schema.mails.userId, userId))
    .groupBy(schema.mails.folder);

  // Recent activity (last 7 days)
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const recentLogs = await db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.userId, userId),
        sql`${schema.auditLogs.createdAt} >= ${sevenDaysAgo}`
      )
    )
    .orderBy(sql`${schema.auditLogs.createdAt} DESC`)
    .limit(20);

  return c.json({
    stats: {
      totalMails: totalMails[0]?.count || 0,
      unreadMails: unreadMails[0]?.count || 0,
      starredMails: starredMails[0]?.count || 0,
      totalAttachments: totalAttachments[0]?.count || 0,
      activeAgents: activeAgents[0]?.count || 0,
      activeWebhooks: activeWebhooks[0]?.count || 0,
    },
    folderCounts: folderCounts.reduce(
      (acc, row) => ({ ...acc, [row.folder]: row.count }),
      {} as Record<string, number>
    ),
    recentActivity: recentLogs,
  });
});

// ─── GET /api/v1/admin/audit-logs ────────────────────────────────────────────
adminApp.get("/audit-logs", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
  const offset = (page - 1) * limit;
  const action = c.req.query("action") || "";

  const conditions = [eq(schema.auditLogs.userId, userId)];
  if (action) {
    conditions.push(eq(schema.auditLogs.action, action));
  }

  const whereClause = and(...conditions);

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.auditLogs)
    .where(whereClause);

  const total = countResult[0]?.count || 0;

  const logs = await db
    .select()
    .from(schema.auditLogs)
    .where(whereClause)
    .orderBy(sql`${schema.auditLogs.createdAt} DESC`)
    .limit(limit)
    .offset(offset);

  return c.json({
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ─── GET /api/v1/admin/login-history ─────────────────────────────────────────
adminApp.get("/login-history", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
  const offset = (page - 1) * limit;

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.loginHistory)
    .where(eq(schema.loginHistory.userId, userId));

  const total = countResult[0]?.count || 0;

  const history = await db
    .select()
    .from(schema.loginHistory)
    .where(eq(schema.loginHistory.userId, userId))
    .orderBy(sql`${schema.loginHistory.createdAt} DESC`)
    .limit(limit)
    .offset(offset);

  return c.json({
    history,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ─── GET /api/v1/admin/labels ────────────────────────────────────────────────
adminApp.get("/labels", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const userLabels = await db
    .select()
    .from(schema.labels)
    .where(eq(schema.labels.userId, userId))
    .orderBy(schema.labels.name);

  return c.json({ labels: userLabels });
});

// ─── POST /api/v1/admin/labels ───────────────────────────────────────────────
adminApp.post("/labels", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  const labelSchema = z.object({
    name: z.string().min(1).max(50),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#3b82f6"),
  });

  const parsed = labelSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.issues },
      400
    );
  }

  const db = getDb(c.env);
  const { name, color } = parsed.data;

  // Check for duplicate name
  const existing = await db
    .select()
    .from(schema.labels)
    .where(and(eq(schema.labels.userId, userId), eq(schema.labels.name, name)))
    .limit(1);

  if (existing.length > 0) {
    return c.json(
      { error: "Label with this name already exists" },
      409
    );
  }

  const id = generateId();
  await db.insert(schema.labels).values({
    id,
    userId,
    name,
    color,
  });

  return c.json({ label: { id, name, color } }, 201);
});

// ─── DELETE /api/v1/admin/labels/:id ─────────────────────────────────────────
adminApp.delete("/labels/:id", async (c) => {
  const userId = c.get("userId");
  const labelId = c.req.param("id");
  const db = getDb(c.env);

  const existing = await db
    .select()
    .from(schema.labels)
    .where(and(eq(schema.labels.id, labelId), eq(schema.labels.userId, userId)))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Label not found" }, 404);
  }

  await db.delete(schema.labels).where(eq(schema.labels.id, labelId));

  return c.json({ success: true });
});

// ─── GET /api/v1/admin/rules ─────────────────────────────────────────────────
adminApp.get("/rules", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const userRules = await db
    .select()
    .from(schema.rules)
    .where(eq(schema.rules.userId, userId))
    .orderBy(schema.rules.priority);

  return c.json({ rules: userRules });
});

// ─── POST /api/v1/admin/rules ────────────────────────────────────────────────
adminApp.post("/rules", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  const ruleSchema = z.object({
    name: z.string().min(1).max(100),
    conditions: z.record(z.unknown()),
    actions: z.record(z.unknown()),
    enabled: z.boolean().default(true),
    priority: z.number().int().min(0).default(0),
  });

  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.issues },
      400
    );
  }

  const db = getDb(c.env);
  const { name, conditions, actions, enabled, priority } = parsed.data;
  const id = generateId();

  await db.insert(schema.rules).values({
    id,
    userId,
    name,
    conditions,
    actions,
    enabled,
    priority,
  });

  return c.json(
    { rule: { id, name, conditions, actions, enabled, priority } },
    201
  );
});

// ─── PUT /api/v1/admin/rules/:id ─────────────────────────────────────────────
adminApp.put("/rules/:id", async (c) => {
  const userId = c.get("userId");
  const ruleId = c.req.param("id");
  const body = await c.req.json();

  const ruleSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    conditions: z.record(z.unknown()).optional(),
    actions: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).optional(),
  });

  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.issues },
      400
    );
  }

  const db = getDb(c.env);

  const existing = await db
    .select()
    .from(schema.rules)
    .where(and(eq(schema.rules.id, ruleId), eq(schema.rules.userId, userId)))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Rule not found" }, 404);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.conditions !== undefined)
    updates.conditions = parsed.data.conditions;
  if (parsed.data.actions !== undefined) updates.actions = parsed.data.actions;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;

  if (Object.keys(updates).length > 0) {
    await db
      .update(schema.rules)
      .set(updates)
      .where(eq(schema.rules.id, ruleId));
  }

  return c.json({ success: true });
});

// ─── DELETE /api/v1/admin/rules/:id ──────────────────────────────────────────
adminApp.delete("/rules/:id", async (c) => {
  const userId = c.get("userId");
  const ruleId = c.req.param("id");
  const db = getDb(c.env);

  const existing = await db
    .select()
    .from(schema.rules)
    .where(and(eq(schema.rules.id, ruleId), eq(schema.rules.userId, userId)))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Rule not found" }, 404);
  }

  await db.delete(schema.rules).where(eq(schema.rules.id, ruleId));

  return c.json({ success: true });
});

// ─── PUT /api/v1/admin/profile ───────────────────────────────────────────────
adminApp.put("/profile", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  const profileSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
  });

  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.issues },
      400
    );
  }

  const db = getDb(c.env);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.email !== undefined) {
    // Check for duplicate email
    const existing = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, parsed.data.email!.toLowerCase()))
      .limit(1);

    if (existing.length > 0 && existing[0].id !== userId) {
      return c.json({ error: "Email already in use" }, 409);
    }
    updates.email = parsed.data.email!.toLowerCase();

    // Update email mapping in KV
    await c.env.KV.put(`email:${parsed.data.email!.toLowerCase()}`, userId);
  }

  await db
    .update(schema.users)
    .set(updates)
    .where(eq(schema.users.id, userId));

  return c.json({ success: true });
});

// ─── PUT /api/v1/admin/password ──────────────────────────────────────────────
adminApp.put("/password", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  const passwordSchema = z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(8),
  });

  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.issues },
      400
    );
  }

  const db = getDb(c.env);

  // Get current user
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (users.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  // Verify current password
  const valid = await comparePassword(
    parsed.data.currentPassword,
    users[0].passwordHash
  );
  if (!valid) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }

  // Hash new password
  const newHash = await hashPassword(parsed.data.newPassword);

  await db
    .update(schema.users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));

  return c.json({ success: true });
});

export { adminApp as adminRoutes };
