import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../worker";

/**
 * McpAgent MCP Server for missive-mail.
 *
 * Exposes 7 tools for managing email via the Model Context Protocol.
 * McpAgent runs inside a Durable Object, so `this.sql` is a built-in
 * SQL interface to the DO's own storage.  For user data that lives in
 * the project's D1 database we reach it through `env.DB` bindings.
 */

interface McpState {
  userId: string;
  email: string;
}

export class MailMCP extends McpAgent<Env, McpState, Record<string, unknown>> {
  name = "missive-mail";
  version = "0.1.0";
  server!: McpServer;

  // ── State helpers ──────────────────────────────────────────────────────
  // The DO may receive initial state from the caller; we also allow
  // it to be set later via an internal call.

  // ── Tool registration ──────────────────────────────────────────────────
  async init() {
    const server = new McpServer({
      name: this.name,
      version: this.version,
    });

    // ─────────────────────────────────────────────────────────────────────
    // 1. mail_list — List emails with optional folder / search / pagination
    // ─────────────────────────────────────────────────────────────────────
    server.tool(
      "mail_list",
      "List emails with optional folder filter, keyword search, and pagination",
      {
        folder: z.string().optional().describe("Folder name: inbox, sent, draft, archive, spam"),
        filter: z.string().optional().describe("Search keyword to match against subject / from / to"),
        page: z.number().optional().describe("Page number (1-indexed, default 1)"),
      },
      async ({ folder, filter, page }) => {
        const db = this.env.DB;
        const limit = 50;
        const offset = ((page ?? 1) - 1) * limit;
        const params: unknown[] = [];
        const conditions: string[] = ["1=1"];

        if (folder) {
          conditions.push("folder = ?");
          params.push(folder);
        }
        if (filter) {
          conditions.push(
            "(subject LIKE ? OR from_addr LIKE ? OR to_addr LIKE ?)"
          );
          const like = `%${filter}%`;
          params.push(like, like, like);
        }

        const where = conditions.join(" AND ");

        const { results } = await db
          .prepare(
            `SELECT id, from_addr AS fromAddr, to_addr AS toAddr, subject, folder,
                    is_read AS isRead, is_starred AS isStarred, labels, importance,
                    created_at AS createdAt
             FROM mails
             WHERE ${where}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`
          )
          .bind(...params, limit, offset)
          .all();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ mails: results, page: page ?? 1 }, null, 2),
            },
          ],
        };
      }
    );

    // ─────────────────────────────────────────────────────────────────────
    // 2. mail_read — Read full email content + mark as read
    // ─────────────────────────────────────────────────────────────────────
    server.tool(
      "mail_read",
      "Read a single email's full content (headers, body, attachments) and mark it as read",
      {
        id: z.string().describe("Mail ID"),
      },
      async ({ id }) => {
        const db = this.env.DB;

        // Fetch mail record
        const mailResult = await db
          .prepare("SELECT * FROM mails WHERE id = ?")
          .bind(id)
          .first();
        if (!mailResult) {
          return {
            content: [{ type: "text" as const, text: "Mail not found" }],
          };
        }

        // Mark as read
        await db
          .prepare("UPDATE mails SET is_read = 1 WHERE id = ?")
          .bind(id)
          .run();

        // Fetch body
        const bodyResult = await db
          .prepare(
            "SELECT text_content AS textContent, html_content AS htmlContent, raw_headers AS rawHeaders FROM mail_bodies WHERE mail_id = ?"
          )
          .bind(id)
          .first();

        // Fetch attachments
        const attResult = await db
          .prepare(
            "SELECT id, filename, mime_type AS mimeType, size, r2_key AS r2Key FROM attachments WHERE mail_id = ?"
          )
          .bind(id)
          .all();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  mail: mailResult,
                  body: bodyResult,
                  attachments: attResult.results ?? [],
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // ─────────────────────────────────────────────────────────────────────
    // 3. mail_send — Compose and send an email
    // ─────────────────────────────────────────────────────────────────────
    server.tool(
      "mail_send",
      "Send an email via Cloudflare Email Service API and record it in the database",
      {
        to: z.string().describe("Recipient email address"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body (plain text or HTML)"),
        cc: z.string().optional().describe("CC email address"),
        bcc: z.string().optional().describe("BCC email address"),
        signature: z.string().optional().describe("Signature to append"),
      },
      async ({ to, subject, body, cc, bcc, signature }) => {
        const db = this.env.DB;
        const apiKey = this.env.CF_EMAIL_SERVICE_API_KEY;

        const fullBody = signature ? `${body}\n\n--\n${signature}` : body;

        // Build mail id
        const mailId = `c${Date.now().toString(36)}${Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map((b) => b.toString(36).padStart(2, "0"))
          .join("")}`;
        const bodyId = `c${Date.now().toString(36)}${Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map((b) => b.toString(36).padStart(2, "0"))
          .join("")}`;

        // We don't know the userId from the MCP state alone — use a placeholder
        // or derive from the caller. For now we use an empty userId; the
        // deployment should set state.userId via the init handshake.
        const userId = this.state?.userId ?? "unknown";

        // Record in DB
        await db
          .prepare(
            `INSERT INTO mails (id, user_id, from_addr, to_addr, subject, folder, is_read, is_starred, labels, importance, spam_score, created_at)
             VALUES (?, ?, ?, ?, ?, 'sent', 1, 0, '[]', 0, 0, ?)`
          )
          .bind(mailId, userId, userId, to, subject, Date.now())
          .run();

        await db
          .prepare(
            `INSERT INTO mail_bodies (id, mail_id, text_content, html_content, raw_headers)
             VALUES (?, ?, ?, NULL, '{}')`
          )
          .bind(bodyId, mailId, fullBody)
          .run();

        // Attempt to send via CF Email Service API if configured
        let sendStatus = "queued";
        if (apiKey) {
          try {
            const resp = await fetch(
              "https://api.cloudflare.com/client/v4/email/api/send",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  from: this.state?.email ?? "noreply@missive-mail.dev",
                  to,
                  cc,
                  bcc,
                  subject,
                  text: fullBody,
                }),
              }
            );
            if (!resp.ok) {
              sendStatus = `send_failed_${resp.status}`;
            }
          } catch (err) {
            sendStatus = `send_error: ${String(err)}`;
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { mailId, status: sendStatus },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // ─────────────────────────────────────────────────────────────────────
    // 4. mail_reply — Reply to an existing email
    // ─────────────────────────────────────────────────────────────────────
    server.tool(
      "mail_reply",
      "Reply to an existing email",
      {
        id: z.string().describe("ID of the email to reply to"),
        body: z.string().describe("Reply body"),
        signature: z.string().optional().describe("Signature to append"),
      },
      async ({ id, body, signature }) => {
        const db = this.env.DB;

        // Look up the original mail
        const original = await db
          .prepare("SELECT * FROM mails WHERE id = ?")
          .bind(id)
          .first();
        if (!original) {
          return {
            content: [{ type: "text" as const, text: "Original mail not found" }],
          };
        }

        const fullBody = signature ? `${body}\n\n--\n${signature}` : body;

        const mailId = `c${Date.now().toString(36)}${Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map((b) => b.toString(36).padStart(2, "0"))
          .join("")}`;
        const bodyId = `c${Date.now().toString(36)}${Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map((b) => b.toString(36).padStart(2, "0"))
          .join("")}`;

        const userId = this.state?.userId ?? "unknown";

        await db
          .prepare(
            `INSERT INTO mails (id, user_id, from_addr, to_addr, subject, folder, is_read, is_starred, labels, importance, spam_score, created_at)
             VALUES (?, ?, ?, ?, ?, 'sent', 1, 0, '[]', 0, 0, ?)`
          )
          .bind(
            mailId,
            userId,
            this.state?.email ?? "unknown",
            (original as Record<string, unknown>).from_addr as string,
            `Re: ${(original as Record<string, unknown>).subject as string}`,
            Date.now()
          )
          .run();

        await db
          .prepare(
            `INSERT INTO mail_bodies (id, mail_id, text_content, html_content, raw_headers)
             VALUES (?, ?, ?, NULL, '{}')`
          )
          .bind(bodyId, mailId, fullBody)
          .run();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { mailId, replyTo: id, status: "created" },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // ─────────────────────────────────────────────────────────────────────
    // 5. mail_manage — Bulk archive / label / delete / star
    // ─────────────────────────────────────────────────────────────────────
    server.tool(
      "mail_manage",
      "Perform bulk actions on emails: archive, label, delete, or star",
      {
        action: z
          .enum(["archive", "label", "delete", "star"])
          .describe("Action to perform"),
        ids: z.array(z.string()).describe("Array of mail IDs"),
        label: z.string().optional().describe("Label name (required when action is 'label')"),
      },
      async ({ action, ids, label }) => {
        const db = this.env.DB;
        if (ids.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No IDs provided" }],
          };
        }

        const placeholders = ids.map(() => "?").join(", ");
        let sql: string;

        switch (action) {
          case "archive":
            sql = `UPDATE mails SET folder = 'archive' WHERE id IN (${placeholders})`;
            break;
          case "delete":
            sql = `DELETE FROM mails WHERE id IN (${placeholders})`;
            break;
          case "star":
            sql = `UPDATE mails SET is_starred = 1 WHERE id IN (${placeholders})`;
            break;
          case "label": {
            if (!label) {
              return {
                content: [{ type: "text" as const, text: "Label name required for label action" }],
              };
            }
            // Fetch existing labels for each mail, merge, then update
            const { results: mails } = await db
              .prepare(
                `SELECT id, labels FROM mails WHERE id IN (${placeholders})`
              )
              .bind(...ids)
              .all();

            for (const mail of mails) {
              const existing: string[] = Array.isArray(
                (mail as Record<string, unknown>).labels
              )
                ? ((mail as Record<string, unknown>).labels as string[])
                : [];
              if (!existing.includes(label)) {
                existing.push(label);
                await db
                  .prepare(`UPDATE mails SET labels = ? WHERE id = ?`)
                  .bind(JSON.stringify(existing), (mail as Record<string, unknown>).id)
                  .run();
              }
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ action, appliedTo: ids.length, label }, null, 2),
                },
              ],
            };
          }
          default:
            return {
              content: [{ type: "text" as const, text: `Unknown action: ${action}` }],
            };
        }

        await db.prepare(sql).bind(...ids).run();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ action, appliedTo: ids.length }, null, 2),
            },
          ],
        };
      }
    );

    // ─────────────────────────────────────────────────────────────────────
    // 6. mail_analyze — Statistics & analytics
    // ─────────────────────────────────────────────────────────────────────
    server.tool(
      "mail_analyze",
      "Get email analytics: total count, unread, per-folder breakdown, monthly trend",
      {
        filter: z
          .string()
          .optional()
          .describe("Optional date range or keyword filter"),
      },
      async ({ filter }) => {
        const db = this.env.DB;

        // Total & unread
        const { results: totals } = await db
          .prepare(
            `SELECT
               COUNT(*) AS total,
               SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread
             FROM mails`
          )
          .all();

        // Per-folder
        const { results: folders } = await db
          .prepare(
            `SELECT folder, COUNT(*) AS count FROM mails GROUP BY folder ORDER BY count DESC`
          )
          .all();

        // Monthly trend (last 12 months)
        const { results: trend } = await db
          .prepare(
            `SELECT
               strftime('%Y-%m', created_at / 1000, 'unixepoch') AS month,
               COUNT(*) AS count
             FROM mails
             GROUP BY month
             ORDER BY month DESC
             LIMIT 12`
          )
          .all();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  totals: totals[0] ?? { total: 0, unread: 0 },
                  byFolder: folders,
                  monthlyTrend: trend,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // ─────────────────────────────────────────────────────────────────────
    // 7. mail_search — Full-text search
    // ─────────────────────────────────────────────────────────────────────
    server.tool(
      "mail_search",
      "Full-text search across email subject, from, to, and body content",
      {
        query: z.string().describe("Search query string"),
        folder: z.string().optional().describe("Restrict search to a specific folder"),
      },
      async ({ query, folder }) => {
        const db = this.env.DB;
        const like = `%${query}%`;
        const conditions: string[] = [
          `(m.subject LIKE ? OR m.from_addr LIKE ? OR m.to_addr LIKE ?)`,
        ];
        const params: unknown[] = [like, like, like];

        if (folder) {
          conditions.push("m.folder = ?");
          params.push(folder);
        }

        const where = conditions.join(" AND ");

        const { results } = await db
          .prepare(
            `SELECT m.id, m.from_addr AS fromAddr, m.to_addr AS toAddr,
                    m.subject, m.folder, m.created_at AS createdAt,
                    b.text_content AS textSnippet
             FROM mails m
             LEFT JOIN mail_bodies b ON b.mail_id = m.id
             WHERE ${where}
             ORDER BY m.created_at DESC
             LIMIT 50`
          )
          .bind(...params)
          .all();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ query, count: results.length, results }, null, 2),
            },
          ],
        };
      }
    );

    this.server = server;
  }
}

export default MailMCP.mount("/mcp", { binding: "MCP_AGENT" });
