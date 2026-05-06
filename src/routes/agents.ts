import { Hono } from "hono";
import { z } from "zod";
import { getDb, schema, eq, and, sql } from "../lib/db";
import { generateId, hashApiKey, authMiddleware, type AuthVariables } from "../lib/auth";
import type { Env } from "../worker";

const agentApp = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// All routes require authentication
agentApp.use("*", authMiddleware());

// ─── Validation Schemas ──────────────────────────────────────────────────────
const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).default(["read"]),
  signatureTemplate: z.string().max(500).optional(),
  rateLimit: z.number().int().min(1).max(1000).default(60),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: z.array(z.string()).optional(),
  signatureTemplate: z.string().max(500).optional(),
  rateLimit: z.number().int().min(1).max(1000).optional(),
  enabled: z.boolean().optional(),
});

// ─── GET /api/v1/agents ──────────────────────────────────────────────────────
agentApp.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const agentList = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.userId, userId))
    .orderBy(sql`${schema.agents.createdAt} DESC`);

  // Don't expose api_key_hash
  const safeAgents = agentList.map(({ apiKeyHash, ...rest }) => rest);

  return c.json({ agents: safeAgents });
});

// ─── POST /api/v1/agents ─────────────────────────────────────────────────────
agentApp.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const parsed = createAgentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.issues },
      400
    );
  }

  const db = getDb(c.env);
  const { name, permissions, signatureTemplate, rateLimit } = parsed.data;

  // Generate API key and hash it
  const apiKey = `msv_${generateId()}${generateId()}`;
  const apiKeyHash = await hashApiKey(apiKey);

  const id = generateId();
  const now = new Date();

  await db.insert(schema.agents).values({
    id,
    userId,
    name,
    apiKeyHash,
    permissions,
    signatureTemplate: signatureTemplate || null,
    rateLimit,
    enabled: true,
    createdAt: now,
  });

  // Audit log
  await db.insert(schema.auditLogs).values({
    id: generateId(),
    userId,
    agentId: id,
    action: "agent.create",
    details: { agentName: name },
    ip: c.req.header("CF-Connecting-IP") || null,
    userAgent: c.req.header("User-Agent") || null,
    createdAt: now,
  });

  return c.json(
    {
      agent: {
        id,
        name,
        permissions,
        signatureTemplate,
        rateLimit,
        enabled: true,
        createdAt: now,
      },
      apiKey, // Only returned once — user must save it!
    },
    201
  );
});

// ─── GET /api/v1/agents/:id ──────────────────────────────────────────────────
agentApp.get("/:id", async (c) => {
  const userId = c.get("userId");
  const agentId = c.req.param("id");
  const db = getDb(c.env);

  const agents = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.userId, userId)))
    .limit(1);

  if (agents.length === 0) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const { apiKeyHash, ...safeAgent } = agents[0];
  return c.json({ agent: safeAgent });
});

// ─── PUT /api/v1/agents/:id ──────────────────────────────────────────────────
agentApp.put("/:id", async (c) => {
  const userId = c.get("userId");
  const agentId = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateAgentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.issues },
      400
    );
  }

  const db = getDb(c.env);

  // Verify agent ownership
  const existing = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.userId, userId)))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.permissions !== undefined)
    updates.permissions = parsed.data.permissions;
  if (parsed.data.signatureTemplate !== undefined)
    updates.signatureTemplate = parsed.data.signatureTemplate;
  if (parsed.data.rateLimit !== undefined)
    updates.rateLimit = parsed.data.rateLimit;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;

  if (Object.keys(updates).length > 0) {
    await db
      .update(schema.agents)
      .set(updates)
      .where(eq(schema.agents.id, agentId));
  }

  return c.json({ success: true });
});

// ─── DELETE /api/v1/agents/:id ───────────────────────────────────────────────
agentApp.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const agentId = c.req.param("id");
  const db = getDb(c.env);

  // Verify agent ownership
  const existing = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.userId, userId)))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Agent not found" }, 404);
  }

  await db.delete(schema.agents).where(eq(schema.agents.id, agentId));

  // Audit log
  await db.insert(schema.auditLogs).values({
    id: generateId(),
    userId,
    agentId,
    action: "agent.delete",
    details: { agentName: existing[0].name },
    ip: c.req.header("CF-Connecting-IP") || null,
    userAgent: c.req.header("User-Agent") || null,
    createdAt: new Date(),
  });

  return c.json({ success: true });
});

// ─── POST /api/v1/agents/:id/regenerate-key ──────────────────────────────────
agentApp.post("/:id/regenerate-key", async (c) => {
  const userId = c.get("userId");
  const agentId = c.req.param("id");
  const db = getDb(c.env);

  // Verify agent ownership
  const existing = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.userId, userId)))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Agent not found" }, 404);
  }

  // Generate new API key
  const newApiKey = `msv_${generateId()}${generateId()}`;
  const newApiKeyHash = await hashApiKey(newApiKey);

  await db
    .update(schema.agents)
    .set({ apiKeyHash: newApiKeyHash })
    .where(eq(schema.agents.id, agentId));

  return c.json({
    apiKey: newApiKey, // Only returned once!
  });
});

export { agentApp as agentRoutes };
