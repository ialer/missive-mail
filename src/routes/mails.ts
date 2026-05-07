import { Hono } from "hono";
import { z } from "zod";
import { getDb, schema, eq, and, sql } from "../lib/db";
import { generateId, authMiddleware, type AuthVariables } from "../lib/auth";
import type { Env } from "../worker";

type MailFolder = "inbox" | "sent" | "draft" | "archive" | "spam";

const mailApp = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// All routes require authentication
mailApp.use("*", authMiddleware());

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

const labelSchema = z.object({
  labels: z.array(z.string()),
});

// ─── GET /api/v1/mails ───────────────────────────────────────────────────────
mailApp.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const folder = (c.req.query("folder") || "inbox") as MailFolder;
  const search = c.req.query("search") || "";
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 100);
  const offset = (page - 1) * limit;
  const starred = c.req.query("starred") === "true";
  const unread = c.req.query("unread") === "true";

  // Build where conditions
  const conditions = [
    eq(schema.mails.userId, userId),
    sql`${schema.mails.folder} = ${folder}`,
  ];

  if (search) {
    conditions.push(
      sql`(${schema.mails.subject} LIKE ${"%" + search + "%"} OR ${schema.mails.fromAddr} LIKE ${"%" + search + "%"})`
    );
  }

  if (starred) {
    conditions.push(eq(schema.mails.isStarred, true));
  }

  if (unread) {
    conditions.push(eq(schema.mails.isRead, false));
  }

  const whereClause = and(...conditions);

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.mails)
    .where(whereClause);

  const total = countResult[0]?.count || 0;

  // Get mails
  const mails = await db
    .select()
    .from(schema.mails)
    .where(whereClause)
    .orderBy(sql`${schema.mails.createdAt} DESC`)
    .limit(limit)
    .offset(offset);

  return c.json({
    mails,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ─── GET /api/v1/mails/:id ──────────────────────────────────────────────────
mailApp.get("/:id", async (c) => {
  const userId = c.get("userId");
  const mailId = c.req.param("id");
  const db = getDb(c.env);

  // Get the mail
  const mails = await db
    .select()
    .from(schema.mails)
    .where(and(eq(schema.mails.id, mailId), eq(schema.mails.userId, userId)))
    .limit(1);

  if (mails.length === 0) {
    return c.json({ error: "Mail not found" }, 404);
  }

  const mail = mails[0];

  // Get body
  const bodies = await db
    .select()
    .from(schema.mailBodies)
    .where(eq(schema.mailBodies.mailId, mailId))
    .limit(1);

  const body = bodies[0] || null;

  // Get attachments
  const atts = await db
    .select()
    .from(schema.attachments)
    .where(eq(schema.attachments.mailId, mailId));

  // Mark as read if not already
  if (!mail.isRead) {
    await db
      .update(schema.mails)
      .set({ isRead: true })
      .where(eq(schema.mails.id, mailId));
  }

  return c.json({
    mail,
    body,
    attachments: atts,
  });
});

// ─── POST /api/v1/mails/send ────────────────────────────────────────────────
mailApp.post("/send", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const parsed = sendMailSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.issues },
      400
    );
  }

  const db = getDb(c.env);

  // Get user email
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (users.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  const user = users[0];
  const { to, subject, text, html, cc, bcc, replyTo, importance } = parsed.data;
  const toAddrs = Array.isArray(to) ? to : [to];

  // Send via Resend
  const resendApiKey = c.env.CF_EMAIL_SERVICE_API_KEY;
  let sendResult: { id: string } = { id: "" };

  if (resendApiKey) {
    // Dynamic import to avoid issues when resend is not configured
    const { Resend } = await import("resend");
    const resend = new Resend(resendApiKey);
    const emailOptions: Record<string, unknown> = {
      from: `mail@${user.domain || "snbar.top"}`,
      to: toAddrs,
      subject,
      text,
      html,
      react: undefined,
    };
    if (cc) emailOptions.cc = Array.isArray(cc) ? cc : [cc];
    if (bcc) emailOptions.bcc = Array.isArray(bcc) ? bcc : [bcc];
    if (replyTo) emailOptions.replyTo = replyTo;

    try {
      const result = await resend.emails.send(emailOptions as any);
      sendResult = { id: result.data?.id || "" };
    } catch (err) {
      console.error("Resend error:", err);
    }
  }

  // Save to sent folder
  const mailId = generateId();
  const bodyId = generateId();
  const now = new Date();

  await db.insert(schema.mails).values({
    id: mailId,
    userId,
    fromAddr: user.email,
    toAddr: toAddrs.join(", "),
    subject,
    folder: "sent" as MailFolder,
    isRead: true,
    isStarred: false,
    labels: [],
    importance: importance || 0,
    spamScore: 0,
    createdAt: now,
  });

  const mailBodyHeaders: Record<string, string> = {};
  mailBodyHeaders["message-id"] = sendResult.id;
  if (cc) mailBodyHeaders.cc = Array.isArray(cc) ? cc.join(", ") : cc;
  if (bcc) mailBodyHeaders.bcc = Array.isArray(bcc) ? bcc.join(", ") : bcc;

  await db.insert(schema.mailBodies).values({
    id: bodyId,
    mailId,
    textContent: text || null,
    htmlContent: html || null,
    rawHeaders: mailBodyHeaders,
  });

  // Audit log
  await db.insert(schema.auditLogs).values({
    id: generateId(),
    userId,
    agentId: null,
    action: "mail.send",
    details: { mailId, to: toAddrs, subject },
    ip: c.req.header("CF-Connecting-IP") || null,
    userAgent: c.req.header("User-Agent") || null,
    createdAt: now,
  });

  return c.json({ mailId, resendId: sendResult.id }, 201);
});

// ─── POST /api/v1/mails/:id/reply ───────────────────────────────────────────
mailApp.post("/:id/reply", async (c) => {
  const userId = c.get("userId");
  const mailId = c.req.param("id");
  const body = await c.req.json();
  const parsed = replySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.issues },
      400
    );
  }

  const db = getDb(c.env);

  // Get original mail
  const origMails = await db
    .select()
    .from(schema.mails)
    .where(and(eq(schema.mails.id, mailId), eq(schema.mails.userId, userId)))
    .limit(1);

  if (origMails.length === 0) {
    return c.json({ error: "Original mail not found" }, 404);
  }

  const origMail = origMails[0];

  // Get user email
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (users.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  const user = users[0];
  const { text, html, cc, bcc } = parsed.data;
  const replySubject = origMail.subject.startsWith("Re: ")
    ? origMail.subject
    : `Re: ${origMail.subject}`;

  // Send via Resend
  const resendApiKey = c.env.CF_EMAIL_SERVICE_API_KEY;
  let sendResult: { id: string } = { id: "" };

  if (resendApiKey) {
    const { Resend } = await import("resend");
    const resend = new Resend(resendApiKey);
    const emailOptions: Record<string, unknown> = {
      from: `mail@${user.domain || "snbar.top"}`,
      to: [origMail.fromAddr],
      subject: replySubject,
      text,
      html,
      react: undefined,
    };
    if (cc) emailOptions.cc = Array.isArray(cc) ? cc : [cc];
    if (bcc) emailOptions.bcc = Array.isArray(bcc) ? bcc : [bcc];
    emailOptions.replyTo = user.email;

    try {
      const result = await resend.emails.send(emailOptions as any);
      sendResult = { id: result.data?.id || "" };
    } catch (err) {
      console.error("Resend error:", err);
    }
  }

  // Save reply to sent folder
  const replyId = generateId();
  const bodyId = generateId();
  const now = new Date();

  await db.insert(schema.mails).values({
    id: replyId,
    userId,
    fromAddr: user.email,
    toAddr: origMail.fromAddr,
    subject: replySubject,
    folder: "sent" as MailFolder,
    isRead: true,
    isStarred: false,
    labels: [],
    importance: origMail.importance,
    spamScore: 0,
    createdAt: now,
  });

  await db.insert(schema.mailBodies).values({
    id: bodyId,
    mailId: replyId,
    textContent: text || null,
    htmlContent: html || null,
    rawHeaders: {
      "in-reply-to": origMail.id,
      "message-id": sendResult.id,
    },
  });

  return c.json({ replyId, resendId: sendResult.id }, 201);
});

// ─── PUT /api/v1/mails/:id/label ────────────────────────────────────────────
mailApp.put("/:id/label", async (c) => {
  const userId = c.get("userId");
  const mailId = c.req.param("id");
  const body = await c.req.json();
  const parsed = labelSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.issues },
      400
    );
  }

  const db = getDb(c.env);

  // Verify mail ownership
  const mails = await db
    .select()
    .from(schema.mails)
    .where(and(eq(schema.mails.id, mailId), eq(schema.mails.userId, userId)))
    .limit(1);

  if (mails.length === 0) {
    return c.json({ error: "Mail not found" }, 404);
  }

  await db
    .update(schema.mails)
    .set({ labels: parsed.data.labels })
    .where(eq(schema.mails.id, mailId));

  return c.json({ success: true, labels: parsed.data.labels });
});

// ─── POST /api/v1/mails/:id/archive ─────────────────────────────────────────
mailApp.post("/:id/archive", async (c) => {
  const userId = c.get("userId");
  const mailId = c.req.param("id");
  const db = getDb(c.env);

  // Verify mail ownership
  const mails = await db
    .select()
    .from(schema.mails)
    .where(and(eq(schema.mails.id, mailId), eq(schema.mails.userId, userId)))
    .limit(1);

  if (mails.length === 0) {
    return c.json({ error: "Mail not found" }, 404);
  }

  await db
    .update(schema.mails)
    .set({ folder: "archive" as MailFolder })
    .where(eq(schema.mails.id, mailId));

  return c.json({ success: true, folder: "archive" });
});

// ─── DELETE /api/v1/mails/:id ────────────────────────────────────────────────
mailApp.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const mailId = c.req.param("id");
  const db = getDb(c.env);

  // Verify mail ownership
  const mails = await db
    .select()
    .from(schema.mails)
    .where(and(eq(schema.mails.id, mailId), eq(schema.mails.userId, userId)))
    .limit(1);

  if (mails.length === 0) {
    return c.json({ error: "Mail not found" }, 404);
  }

  // Delete attachments from R2
  const atts = await db
    .select()
    .from(schema.attachments)
    .where(eq(schema.attachments.mailId, mailId));

  for (const att of atts) {
    try {
      await c.env.R2.delete(att.r2Key);
    } catch {
      // Ignore R2 deletion errors
    }
  }

  // Delete mail body
  await db.delete(schema.mailBodies).where(eq(schema.mailBodies.mailId, mailId));

  // Delete attachments record
  await db.delete(schema.attachments).where(eq(schema.attachments.mailId, mailId));

  // Delete the mail itself
  await db.delete(schema.mails).where(eq(schema.mails.id, mailId));

  return c.json({ success: true });
});

// ─── GET /api/v1/mails/:id/status ────────────────────────────────────────────
mailApp.get("/:id/status", async (c) => {
  const userId = c.get("userId");
  const mailId = c.req.param("id");
  const db = getDb(c.env);

  const mails = await db
    .select({
      id: schema.mails.id,
      isRead: schema.mails.isRead,
      isStarred: schema.mails.isStarred,
      labels: schema.mails.labels,
    })
    .from(schema.mails)
    .where(and(eq(schema.mails.id, mailId), eq(schema.mails.userId, userId)))
    .limit(1);

  if (mails.length === 0) {
    return c.json({ error: "Mail not found" }, 404);
  }

  return c.json(mails[0]);
});

export { mailApp as mailRoutes };
