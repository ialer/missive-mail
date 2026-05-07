import { Hono } from "hono";
import { z } from "zod";
import { getDb, schema, eq, and, like, sql } from "../lib/db";
import { generateId, authMiddleware, agentAuthMiddleware, type AuthVariables } from "../lib/auth";
import type { Env } from "../worker";

type MailFolder = "inbox" | "sent" | "draft" | "archive" | "spam";

const mailApp = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Combined auth: accept JWT Bearer token OR X-Agent-Token
mailApp.use("*", async (c, next) => {
  // Try agent token first
  const agentToken = c.req.header("X-Agent-Token");
  if (agentToken) {
    return agentAuthMiddleware()(c, next);
  }
  // Fall back to JWT
  return authMiddleware()(c, next);
});

// ─── Validation Schemas ──────────────────────────────────────────────────────
const sendMailSchema = z.object({
  to: z.string().email().or(z.array(z.string().email())),
  subject: z.string().min(1),
  text: z.string().optional(),
  html: z.string().optional(),
  cc: z.string().email().or(z.array(z.string().email())).optional(),
  bcc: z.string().email().or(z.array(z.string().email())).optional(),
  replyTo: z.string().email().optional(),
  importance: z.number().int().min(0).max(5).optional(),
});

const replySchema = z.object({
  text: z.string().optional(),
  html: z.string().optional(),
  cc: z.string().email().or(z.array(z.string().email())).optional(),
  bcc: z.string().email().or(z.array(z.string().email())).optional(),
});

// ─── GET /api/v1/mails ──────────────────────────────────────────────────────
mailApp.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const folder = c.req.query("folder") as MailFolder | undefined;
  const label = c.req.query("label");
  const search = c.req.query("search");
  const starred = c.req.query("starred") === "true";
  const unread = c.req.query("unread") === "true";
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const offset = (page - 1) * limit;

  const conditions: any[] = [eq(schema.mails.userId, userId)];

  if (folder) {
    conditions.push(eq(schema.mails.folder, folder));
  }
  if (starred) {
    conditions.push(eq(schema.mails.isStarred, true));
  }
  if (unread) {
    conditions.push(eq(schema.mails.isRead, false));
  }
  if (search) {
    const like = `%${search}%`;
    conditions.push(sql`(${schema.mails.subject} LIKE ${like} OR ${schema.mails.fromAddr} LIKE ${like} OR ${schema.mails.toAddr} LIKE ${like})`);
  }
  if (label) {
    conditions.push(sql`EXISTS (SELECT 1 FROM json_each(${schema.mails.labels}) WHERE value = ${label})`);
  }

  const where = and(...conditions);

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.mails)
    .where(where)
    .then((r) => r[0]?.count || 0);

  const mails = await db
    .select()
    .from(schema.mails)
    .where(where)
    .orderBy(sql`${schema.mails.createdAt} DESC`)
    .limit(limit)
    .offset(offset);

  return c.json({
    mails,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// ─── GET /api/v1/mails/analytics ─────────────────────────────────────────────
mailApp.get("/analytics", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const totals = await db
    .select({
      total: sql<number>`count(*)`,
      unread: sql<number>`sum(case when is_read = 0 then 1 else 0 end)`,
    })
    .from(schema.mails)
    .where(eq(schema.mails.userId, userId))
    .then((r) => r[0]);

  const byFolder = await db
    .select({ folder: schema.mails.folder, count: sql<number>`count(*)` })
    .from(schema.mails)
    .where(eq(schema.mails.userId, userId))
    .groupBy(schema.mails.folder);

  return c.json({ totals, byFolder });
});

// ─── GET /api/v1/mails/:id/conversation ─────────────────────────────────────
mailApp.get("/:id/conversation", async (c) => {
  const userId = c.get("userId");
  const mailId = c.req.param("id");
  const db = getDb(c.env);

  const seed = await db
    .select()
    .from(schema.mails)
    .where(and(eq(schema.mails.id, mailId), eq(schema.mails.userId, userId)))
    .limit(1);

  if (seed.length === 0) {
    return c.json({ error: "Mail not found" }, 404);
  }

  // Strip all Re:/Fwd: prefixes to get core subject
  let coreSubject = seed[0].subject;
  while (/^(Re|Fwd?|Aw|Sv):\s*/i.test(coreSubject)) {
    coreSubject = coreSubject.replace(/^(Re|Fwd?|Aw|Sv):\s*/i, "");
  }

  // Simple: find all mails whose subject ends with the core subject
  // This matches "Re: Re: 测试", "Fwd: 测试", "测试" etc.
  const allMails = await db
    .select()
    .from(schema.mails)
    .where(
      and(
        eq(schema.mails.userId, userId),
        sql`LOWER(${schema.mails.subject}) LIKE ${"%" + coreSubject.toLowerCase()}`
      )
    )
    .orderBy(sql`${schema.mails.createdAt} ASC`)
    .limit(50);

  // Fallback to single mail if no thread
  if (allMails.length === 0) {
    const body = await db.select().from(schema.mailBodies).where(eq(schema.mailBodies.mailId, mailId)).limit(1);
    const users = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    const myEmail = users[0]?.email || "";
    return c.json({
      conversation: {
        id: seed[0].id,
        subject: seed[0].subject,
        messages: [{
          ...seed[0],
          body: body[0]?.textContent || "",
          htmlBody: body[0]?.htmlContent || "",
          isOwn: seed[0].fromAddr === myEmail,
          attachments: [],
        }],
      },
    });
  }

  // Fetch bodies
  const mailIds = allMails.map((m) => m.id);
  const bodies = await db
    .select()
    .from(schema.mailBodies)
    .where(sql`${schema.mailBodies.mailId} IN (${sql.join(mailIds.map((id) => sql`${id}`), sql`, `)})`);
  const bodyMap = new Map(bodies.map((b) => [b.mailId, b]));

  const users = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const myEmail = users[0]?.email || "";

  // Mark all as read
  const unreadIds = allMails.filter((m) => !m.isRead).map((m) => m.id);
  if (unreadIds.length > 0) {
    await db.update(schema.mails).set({ isRead: true }).where(sql`${schema.mails.id} IN (${sql.join(unreadIds.map((id) => sql`${id}`), sql`, `)})`);
  }

  const messages = allMails.map((mail) => {
    const body = bodyMap.get(mail.id);
    return {
      ...mail,
      body: body?.textContent || "",
      htmlBody: body?.htmlContent || "",
      isOwn: mail.fromAddr === myEmail,
      attachments: [] as any[],
    };
  });

  // Deduplicate: same sender + subject + timestamp = same message (sent/inbox copies)
  const seen = new Set<string>();
  const deduped = messages.filter((m) => {
    const key = `${m.fromAddr}::${m.subject}::${m.createdAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Attachments
  const attachments = await db
    .select()
    .from(schema.attachments)
    .where(sql`${schema.attachments.mailId} IN (${sql.join(mailIds.map((id) => sql`${id}`), sql`, `)})`);
  const attMap = new Map<string, any[]>();
  for (const att of attachments) {
    const list = attMap.get(att.mailId) || [];
    list.push(att);
    attMap.set(att.mailId, list);
  }
  for (const msg of deduped) {
    msg.attachments = attMap.get(msg.id) || [];
  }

  return c.json({
    conversation: {
      id: seed[0].id,
      subject: seed[0].subject,
      messages: deduped,
    },
  });
});

// ─── GET /api/v1/mails/:id ──────────────────────────────────────────────────
mailApp.get("/:id", async (c) => {
  const userId = c.get("userId");
  const mailId = c.req.param("id");
  const db = getDb(c.env);

  const mails = await db
    .select()
    .from(schema.mails)
    .where(and(eq(schema.mails.id, mailId), eq(schema.mails.userId, userId)))
    .limit(1);

  if (mails.length === 0) {
    return c.json({ error: "Mail not found" }, 404);
  }

  // Mark as read
  if (!mails[0].isRead) {
    await db.update(schema.mails).set({ isRead: true }).where(eq(schema.mails.id, mailId));
  }

  // Get body
  const bodies = await db
    .select()
    .from(schema.mailBodies)
    .where(eq(schema.mailBodies.mailId, mailId))
    .limit(1);

  // Get attachments
  const attachments = await db
    .select()
    .from(schema.attachments)
    .where(eq(schema.attachments.mailId, mailId));

  return c.json({
    mail: mails[0],
    body: bodies[0] || null,
    attachments,
  });
});

// ─── POST /api/v1/mails/send ────────────────────────────────────────────────
mailApp.post("/send", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const parsed = sendMailSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const db = getDb(c.env);
  const { to, subject, text, html, cc, bcc, replyTo, importance } = parsed.data;

  const mailId = generateId();
  const bodyId = generateId();
  const now = new Date();

  // Get user email for from address
  const users = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const fromAddr = users[0]?.email || userId;

  await db.insert(schema.mails).values({
    id: mailId,
    userId,
    fromAddr,
    toAddr: Array.isArray(to) ? to.join(",") : to,
    subject,
    folder: "sent",
    isRead: true,
    isStarred: false,
    labels: [],
    importance: importance || 0,
    spamScore: 0,
    createdAt: now,
  });

  await db.insert(schema.mailBodies).values({
    id: bodyId,
    mailId,
    textContent: text || null,
    htmlContent: html || null,
    rawHeaders: { cc, bcc, replyTo },
  });

  // If sending to self, also create an inbox copy
  const toAddrs = Array.isArray(to) ? to : [to];
  if (toAddrs.includes(fromAddr)) {
    const inboxMailId = generateId();
    const inboxBodyId = generateId();
    await db.insert(schema.mails).values({
      id: inboxMailId,
      userId,
      fromAddr,
      toAddr: fromAddr,
      subject,
      folder: "inbox",
      isRead: false,
      isStarred: false,
      labels: [],
      importance: importance || 0,
      spamScore: 0,
      createdAt: now,
    });
    await db.insert(schema.mailBodies).values({
      id: inboxBodyId,
      mailId: inboxMailId,
      textContent: text || null,
      htmlContent: html || null,
      rawHeaders: { cc, bcc, replyTo },
    });
  }

  // Try to send via Resend API if configured
  let sendStatus = "recorded";
  const resendKey = c.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddr,
          to: Array.isArray(to) ? to : [to],
          subject,
          text,
          html,
        }),
      });
      if (resp.ok) {
        sendStatus = "sent";
      } else {
        sendStatus = `send_failed_${resp.status}`;
      }
    } catch (err) {
      sendStatus = `send_error: ${String(err)}`;
    }
  }

  return c.json({ mailId, status: sendStatus }, 201);
});

// ─── POST /api/v1/mails/:id/reply ───────────────────────────────────────────
mailApp.post("/:id/reply", async (c) => {
  const userId = c.get("userId");
  const mailId = c.req.param("id");
  const body = await c.req.json();
  const parsed = replySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const db = getDb(c.env);

  // Find original mail
  const original = await db
    .select()
    .from(schema.mails)
    .where(and(eq(schema.mails.id, mailId), eq(schema.mails.userId, userId)))
    .limit(1);

  if (original.length === 0) {
    return c.json({ error: "Original mail not found" }, 404);
  }

  const newMailId = generateId();
  const bodyId = generateId();
  const now = new Date();

  const users = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const fromAddr = users[0]?.email || userId;

  // Find the correct reply recipient by searching the entire conversation thread
  // for the first sender who is NOT the current user
  // Strip all Re:/RE: prefixes to get core subject
  let coreSubject = original[0].subject.trim();
  while (/^Re:\s*/i.test(coreSubject)) {
    coreSubject = coreSubject.replace(/^Re:\s*/i, "");
  }
  const threadMails = await db
    .select()
    .from(schema.mails)
    .where(
      and(
        eq(schema.mails.userId, userId),
        like(schema.mails.subject, `%${coreSubject}%`)
      )
    );
  let replyTo = original[0].toAddr;
  for (let i = 0; i < threadMails.length; i++) {
    if (threadMails[i].fromAddr !== fromAddr) {
      replyTo = threadMails[i].fromAddr;
      break;
    }
  }

  await db.insert(schema.mails).values({
    id: newMailId,
    userId,
    fromAddr,
    toAddr: replyTo,
    subject: `Re: ${original[0].subject}`,
    folder: "sent",
    isRead: true,
    isStarred: false,
    labels: [],
    importance: 0,
    spamScore: 0,
    createdAt: now,
  });

  await db.insert(schema.mailBodies).values({
    id: bodyId,
    mailId: newMailId,
    textContent: parsed.data.text || null,
    htmlContent: parsed.data.html || null,
    rawHeaders: {},
  });

  // Also create inbox copy so reply appears in conversation thread
  const inboxMailId = generateId();
  const inboxBodyId = generateId();
  await db.insert(schema.mails).values({
    id: inboxMailId,
    userId,
    fromAddr,
    toAddr: replyTo,
    subject: `Re: ${original[0].subject}`,
    folder: "inbox",
    isRead: true,
    isStarred: false,
    labels: [],
    importance: 0,
    spamScore: 0,
    createdAt: now,
  });
  await db.insert(schema.mailBodies).values({
    id: inboxBodyId,
    mailId: inboxMailId,
    textContent: parsed.data.text || null,
    htmlContent: parsed.data.html || null,
    rawHeaders: {},
  });

  // Try to send via Resend API if configured
  let sendStatus = "recorded";
  const resendKey = c.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [replyTo],
          subject: `Re: ${original[0].subject}`,
          text: parsed.data.text || undefined,
          html: parsed.data.html || undefined,
        }),
      });
      if (resp.ok) {
        sendStatus = "sent";
      } else {
        const err = await resp.text();
        sendStatus = `send_failed_${resp.status}: ${err}`;
      }
    } catch (err) {
      sendStatus = `send_error: ${String(err)}`;
    }
  }

  return c.json({ mailId: newMailId, replyTo: mailId, status: sendStatus }, 201);
});

// ─── POST /api/v1/mails/:id/archive ─────────────────────────────────────────
mailApp.post("/:id/archive", async (c) => {
  const userId = c.get("userId");
  const mailId = c.req.param("id");
  const db = getDb(c.env);

  await db
    .update(schema.mails)
    .set({ folder: "archive" })
    .where(and(eq(schema.mails.id, mailId), eq(schema.mails.userId, userId)));

  return c.json({ success: true });
});

// ─── PUT /api/v1/mails/:id/label ────────────────────────────────────────────
mailApp.put("/:id/label", async (c) => {
  const userId = c.get("userId");
  const mailId = c.req.param("id");
  const { labels } = await c.req.json();
  const db = getDb(c.env);

  await db
    .update(schema.mails)
    .set({ labels })
    .where(and(eq(schema.mails.id, mailId), eq(schema.mails.userId, userId)));

  return c.json({ success: true });
});

// ─── DELETE /api/v1/mails/:id ───────────────────────────────────────────────
mailApp.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const mailId = c.req.param("id");
  const db = getDb(c.env);

  await db
    .delete(schema.mails)
    .where(and(eq(schema.mails.id, mailId), eq(schema.mails.userId, userId)));

  return c.json({ success: true });
});

// ─── POST /api/v1/mails/inbound (Agent/External inbound) ─────────────────────
mailApp.post("/inbound", async (c) => {
  const body = await c.req.json();
  const { from, to, subject, text, html } = body;

  if (!from || !to || !subject) {
    return c.json({ error: "Missing required fields: from, to, subject" }, 400);
  }

  const db = getDb(c.env);

  // Find recipient user via KV mapping
  const userId = await c.env.KV.get(`email:${to.toLowerCase()}`);
  if (!userId) {
    return c.json({ error: `No mailbox found for ${to}` }, 404);
  }

  const mailId = generateId();
  const bodyId = generateId();
  const now = new Date();

  await db.insert(schema.mails).values({
    id: mailId,
    userId,
    fromAddr: from,
    toAddr: to,
    subject,
    folder: "inbox" as const,
    isRead: false,
    isStarred: false,
    labels: [],
    importance: 0,
    spamScore: 0,
    createdAt: now,
  });

  await db.insert(schema.mailBodies).values({
    id: bodyId,
    mailId,
    textContent: text || null,
    htmlContent: html || null,
    rawHeaders: { source: "agent-api" },
  });

  return c.json({ mailId, folder: "inbox" }, 201);
});

export { mailApp as mailRoutes };
