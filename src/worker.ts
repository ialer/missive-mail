import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { authRoutes } from "./routes/auth";
import { mailRoutes } from "./routes/mails";
import { agentRoutes } from "./routes/agents";
import { webhookRoutes } from "./routes/webhooks";
import { adminRoutes } from "./routes/admin";
import { getDb, eq, sql } from "./lib/db";
import { MailMCP } from "./mcp/mail-mcp";
import { generateId } from "./lib/auth";
import * as schema from "./schema";
import queueConsumer from "./lib/queue";

// ─── Env Interface (matches wrangler.toml bindings + secrets) ────────────────
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  QUEUE: Queue;
  ASSETS: { fetch: typeof fetch };
  JWT_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  CF_EMAIL_SERVICE_API_KEY?: string;
}

// ─── Hono App ────────────────────────────────────────────────────────────────
const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use("*", logger());
app.use("*", cors());
app.use("*", prettyJSON());

// Health check
app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: Date.now() });
});

// Register route groups
app.route("/auth", authRoutes);
app.route("/api/v1/mails", mailRoutes);
app.route("/api/v1/agents", agentRoutes);
app.route("/api/v1/webhooks", webhookRoutes);
app.route("/api/v1/admin", adminRoutes);

// Fallback: serve static assets from the web/dist directory
app.get("*", async (c) => {
  if (c.env.ASSETS) {
    try {
      const response = await c.env.ASSETS.fetch(c.req.raw);
      if (response.status !== 404) {
        return response;
      }
    } catch {
      // Fall through to SPA fallback
    }
  }

  // SPA fallback: return index.html for non-API routes
  if (c.env.ASSETS) {
    try {
      const indexReq = new Request(new URL("/", c.req.url), c.req.raw);
      const indexResponse = await c.env.ASSETS.fetch(indexReq);
      if (indexResponse.status === 200) {
        return indexResponse;
      }
    } catch {
      // ignore
    }
  }

  return c.json({ error: "Not Found" }, 404);
});

// ─── Email Handler ───────────────────────────────────────────────────────────
async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  try {
    const PostalMime = (await import("postal-mime")).default;

    const rawEmail = await new Response(message.raw).text();
    const parsed = await PostalMime.parse(rawEmail);

    const db = getDb(env);

    const toAddr = message.to;
    const fromAddr = message.from;
    const subject = parsed.subject || "(no subject)";

    // Find user via KV mapping (email → user_id)
    const userId = await env.KV.get(`email:${toAddr.toLowerCase()}`);

    if (!userId) {
      message.setReject(`No mailbox found for ${toAddr}`);
      return;
    }

    // Create the mail record
    const mailId = generateId();
    const bodyId = generateId();
    const now = new Date();

    const headers = parsed.headers as unknown as Record<string, string> | undefined;
    const importance = headers?.["x-priority"]
      ? parseInt(headers["x-priority"], 10) || 0
      : 0;

    await db.insert(schema.mails).values({
      id: mailId,
      userId,
      fromAddr,
      toAddr,
      subject,
      folder: "inbox" as const,
      isRead: false,
      isStarred: false,
      labels: [],
      importance,
      spamScore: 0,
      createdAt: now,
    });

    // Convert headers to Record<string, string>
    const rawHeaders: Record<string, string> = {};
    if (parsed.headers) {
      for (const [key, value] of Object.entries(parsed.headers)) {
        rawHeaders[key] = String(value);
      }
    }

    await db.insert(schema.mailBodies).values({
      id: bodyId,
      mailId,
      textContent: parsed.text || null,
      htmlContent: parsed.html || null,
      rawHeaders,
    });

    // Handle attachments
    if (parsed.attachments && parsed.attachments.length > 0) {
      for (const att of parsed.attachments) {
        const attId = generateId();
        const r2Key = `attachments/${userId}/${mailId}/${att.filename}`;

        const content = att.content;
        if (content) {
          const contentBytes =
            content instanceof Uint8Array
              ? content
              : typeof content === "string"
                ? new TextEncoder().encode(content)
                : new Uint8Array(content);

          await env.R2.put(r2Key, contentBytes, {
            httpMetadata: { contentType: att.mimeType },
          });

          await db.insert(schema.attachments).values({
            id: attId,
            mailId,
            filename: att.filename || "unknown",
            mimeType: att.mimeType || "application/octet-stream",
            size: contentBytes.byteLength,
            r2Key,
          });
        } else {
          await db.insert(schema.attachments).values({
            id: attId,
            mailId,
            filename: att.filename || "unknown",
            mimeType: att.mimeType || "application/octet-stream",
            size: 0,
            r2Key,
          });
        }
      }
    }

    // Evaluate user rules
    const userRules = await db
      .select()
      .from(schema.rules)
      .where(sql`${schema.rules.userId} = ${userId} AND ${schema.rules.enabled} = 1`)
      .orderBy(schema.rules.priority);

    for (const rule of userRules) {
      const conditions = rule.conditions as Record<string, unknown>;
      const actions = rule.actions as Record<string, unknown>;

      let match = true;
      if (conditions.from && typeof conditions.from === "string") {
        match = match && fromAddr.toLowerCase().includes(conditions.from.toLowerCase());
      }
      if (conditions.subject && typeof conditions.subject === "string") {
        match = match && subject.toLowerCase().includes(conditions.subject.toLowerCase());
      }

      if (match) {
        if (actions.moveToFolder && typeof actions.moveToFolder === "string") {
          await db
            .update(schema.mails)
            .set({ folder: actions.moveToFolder as "inbox" | "sent" | "draft" | "archive" | "spam" })
            .where(eq(schema.mails.id, mailId));
        }
        if (actions.addLabel && typeof actions.addLabel === "string") {
          const currentMail = await db
            .select({ labels: schema.mails.labels })
            .from(schema.mails)
            .where(eq(schema.mails.id, mailId))
            .limit(1);
          const currentLabels = (currentMail[0]?.labels as string[]) || [];
          await db
            .update(schema.mails)
            .set({ labels: [...currentLabels, actions.addLabel as string] })
            .where(eq(schema.mails.id, mailId));
        }
        if (actions.markAsSpam) {
          await db
            .update(schema.mails)
            .set({ folder: "spam" as const })
            .where(eq(schema.mails.id, mailId));
        }
      }
    }

    // Trigger webhooks
    const webhooks = await db
      .select()
      .from(schema.webhooks)
      .where(sql`${schema.webhooks.userId} = ${userId} AND ${schema.webhooks.enabled} = 1`);

    for (const webhook of webhooks) {
      const events = webhook.events as string[];
      if (events.includes("mail.received")) {
        await env.QUEUE.send({
          webhookId: webhook.id,
          event: "mail.received",
          payload: {
            mailId,
            from: fromAddr,
            to: toAddr,
            subject,
            receivedAt: now.toISOString(),
          },
        });
      }
    }
  } catch (error) {
    console.error("Email handler error:", error);
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────
// Re-export MailMCP for Durable Object binding
export { MailMCP };

export default {
  fetch: app.fetch,
  queue: queueConsumer.queue,
  email: handleEmail,
};
