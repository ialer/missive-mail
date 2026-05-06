import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // cuid style
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull().default(""),
  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
  twoFaVerifiedAt: integer("two_fa_verified_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ─── Mails ───────────────────────────────────────────────────────────────────
export const mails = sqliteTable("mails", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  fromAddr: text("from_addr").notNull(),
  toAddr: text("to_addr").notNull(),
  subject: text("subject").notNull().default(""),
  folder: text("folder", { enum: ["inbox", "sent", "draft", "archive", "spam"] })
    .notNull()
    .default("inbox"),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  isStarred: integer("is_starred", { mode: "boolean" }).notNull().default(false),
  labels: text("labels", { mode: "json" }).$type<string[]>().default([]),
  importance: integer("importance").notNull().default(0),
  spamScore: real("spam_score").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Mail Bodies ─────────────────────────────────────────────────────────────
export const mailBodies = sqliteTable("mail_bodies", {
  id: text("id").primaryKey(),
  mailId: text("mail_id")
    .notNull()
    .references(() => mails.id, { onDelete: "cascade" }),
  textContent: text("text_content"),
  htmlContent: text("html_content"),
  rawHeaders: text("raw_headers", { mode: "json" }).$type<Record<string, string>>(),
});

// ─── Attachments ─────────────────────────────────────────────────────────────
export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  mailId: text("mail_id")
    .notNull()
    .references(() => mails.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  r2Key: text("r2_key").notNull(),
});

// ─── Labels ──────────────────────────────────────────────────────────────────
export const labels = sqliteTable("labels", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  color: text("color").notNull().default("#3b82f6"),
});

// ─── Rules ───────────────────────────────────────────────────────────────────
export const rules = sqliteTable("rules", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  conditions: text("conditions", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  actions: text("actions", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull().default(0),
});

// ─── Agents ──────────────────────────────────────────────────────────────────
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  apiKeyHash: text("api_key_hash").notNull(),
  permissions: text("permissions", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  signatureTemplate: text("signature_template"),
  rateLimit: integer("rate_limit").notNull().default(60), // requests per minute
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Webhooks ────────────────────────────────────────────────────────────────
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  url: text("url").notNull(),
  events: text("events", { mode: "json" }).$type<string[]>().notNull(),
  filter: text("filter", { mode: "json" }).$type<Record<string, unknown>>(),
  secretHash: text("secret_hash").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Audit Logs ──────────────────────────────────────────────────────────────
export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  agentId: text("agent_id").references(() => agents.id),
  action: text("action").notNull(),
  details: text("details", { mode: "json" }).$type<Record<string, unknown>>(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Login History ───────────────────────────────────────────────────────────
export const loginHistory = sqliteTable("login_history", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  ip: text("ip"),
  userAgent: text("user_agent"),
  success: integer("success", { mode: "boolean" }).notNull(),
  failureReason: text("failure_reason"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Type exports ────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Mail = typeof mails.$inferSelect;
export type NewMail = typeof mails.$inferInsert;
export type MailBody = typeof mailBodies.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Label = typeof labels.$inferSelect;
export type Rule = typeof rules.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type LoginHistory = typeof loginHistory.$inferSelect;
