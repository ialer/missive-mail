# 📬 Missive Mail

> *"The Lich King sends his regards."* — A mail server forged in the cold of Northrend.

Missive Mail is a self-hosted email service built on **Cloudflare Workers**, combining a modern REST API with **MCP (Model Context Protocol)** for AI agent integration. Named after Warcraft's "missive" (a written message sent by a messenger), it's your personal mail infrastructure on the edge.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers |
| API Framework | Hono |
| Database | D1 (SQLite) + Drizzle ORM |
| Key-Value | Cloudflare KV |
| Object Storage | Cloudflare R2 |
| Queue | Cloudflare Queues |
| Frontend | React (Vite) |
| AI Integration | MCP SDK + Cloudflare Agents |
| Email Parsing | postal-mime |
| Validation | Zod |
| Testing | Vitest |

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) ≥ 4
- Cloudflare account with Workers paid plan (for D1, R2, Queues)

### Development

```bash
# Clone and install
git clone <repo-url> missive-mail
cd missive-mail
npm install

# Start local dev (uses miniflare)
npm run dev

# Run tests
npm test

# Build frontend
npm run build:web
```

### Deploy

```bash
# One-click deploy (creates all resources + deploys)
bash scripts/deploy.sh

# Or step by step:
wrangler d1 migrations apply mail-db
wrangler deploy
```

### Email Routing Setup

```bash
# Configure CF Email Routing for your domain
bash scripts/setup-email.sh yourdomain.com
```

---

## Configuration

### Environment Variables (Secrets)

Set via `wrangler secret put <NAME>` or CF Dashboard:

| Secret | Description | Required |
|--------|------------|----------|
| `JWT_SECRET` | Secret key for JWT signing (HS256) | Yes |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret for captcha | No |
| `CF_EMAIL_SERVICE_API_KEY` | API key for outbound email (Resend/CF) | No |

### wrangler.toml Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `DB` | D1 | Main database (mails, users, etc.) |
| `KV` | KV | Email→User ID mapping, caches |
| `R2` | R2 | Attachment storage |
| `QUEUE` | Queue | Webhook delivery queue |
| `ASSETS` | Assets | Static frontend files |

---

## API Documentation

### REST API

#### Authentication

```
POST /auth/register          — Register new user
POST /auth/login             — Login (returns JWT)
POST /auth/refresh           — Refresh access token
POST /auth/logout            — Logout
POST /auth/change-password   — Change password
POST /auth/setup-totp        — Enable TOTP 2FA
POST /auth/verify-totp       — Verify TOTP code
```

#### Mails

```
GET    /api/v1/mails                 — List mails (query: folder, page, search)
GET    /api/v1/mails/:id             — Get mail detail
POST   /api/v1/mails                 — Send mail (draft or send)
PATCH  /api/v1/mails/:id             — Update mail (folder, labels, read, star)
DELETE /api/v1/mails/:id             — Delete mail
GET    /api/v1/mails/:id/attachments — List attachments
GET    /api/v1/mails/:id/attachments/:attId — Download attachment
```

#### Agents

```
GET    /api/v1/agents        — List agents
POST   /api/v1/agents        — Create agent
GET    /api/v1/agents/:id    — Get agent details
PATCH  /api/v1/agents/:id    — Update agent
DELETE /api/v1/agents/:id    — Delete agent
POST   /api/v1/agents/:id/rotate-key — Rotate API key
```

#### Webhooks

```
GET    /api/v1/webhooks        — List webhooks
POST   /api/v1/webhooks        — Create webhook
GET    /api/v1/webhooks/:id    — Get webhook
PATCH  /api/v1/webhooks/:id    — Update webhook
DELETE /api/v1/webhooks/:id    — Delete webhook
```

#### Admin

```
GET /api/v1/admin/stats  — System stats
GET /api/v1/admin/audit  — Audit log
```

### MCP (Model Context Protocol)

The Worker exposes MCP endpoints for AI agent integration:

```
POST /mcp       — MCP JSON-RPC endpoint
GET  /mcp/sse   — SSE transport for MCP
```

MCP Tools available:
- `read_mail` — Read a specific mail
- `list_mails` — Search/list mails
- `send_mail` — Compose and send a mail
- `manage_labels` — CRUD labels
- `get_attachments` — List/download attachments

### Agent API (X-Agent-Token)

Agents authenticate via `X-Agent-Token` header instead of JWT:

```
Authorization: <not used>
X-Agent-Token: mk_agent_xxxxxxxxxxxx
```

---

## Architecture

```
                          ┌──────────────────────┐
                          │     Cloudflare CDN    │
                          │    (Edge Network)     │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │   CF Email Routing    │
                          │  (MX → Worker)        │
                          └──────────┬───────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────────────────┐
│                        Missive Mail Worker                              │
│                                                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌────────────┐  │
│  │  Hono   │  │  Auth   │  │  Spam   │  │  Rules   │  │   Email    │  │
│  │ Router  │──│Middleware│──│ Filter  │──│ Engine   │──│  Handler   │  │
│  └─────────┘  └─────────┘  └─────────┘  └──────────┘  └────────────┘  │
│       │                                                     │          │
│  ┌────▼─────────────────────────────────────────────────────▼───────┐  │
│  │                     Drizzle ORM                                  │  │
│  └────┬──────────────┬──────────────┬──────────────┬────────────────┘  │
│       │              │              │              │                    │
└───────┼──────────────┼──────────────┼──────────────┼────────────────────┘
        │              │              │              │
  ┌─────▼─────┐  ┌─────▼─────┐  ┌────▼────┐  ┌─────▼─────┐
  │  D1 (SQL) │  │    KV     │  │   R2    │  │  Queue    │
  │  Mails    │  │ Email Map │  │ Attach- │  │ Webhook   │
  │  Users    │  │  Cache    │  │ ments   │  │ Delivery  │
  │  Agents   │  └──────────┘  └─────────┘  └───────────┘
  │  Rules    │
  └───────────┘

        ┌─────────────────────────────┐
        │     Frontend (React)        │
        │  ┌───────────────────────┐  │
        │  │  Mail UI / Dashboard  │  │
        │  │  Login / Settings     │  │
        │  └───────────────────────┘  │
        │  Served via CF Workers      │
        │  Assets (web/dist/)         │
        └─────────────────────────────┘

        ┌─────────────────────────────┐
        │     AI Agents (MCP)         │
        │  ┌───────────────────────┐  │
        │  │  Cloudflare Agents    │  │
        │  │  + MCP SDK            │  │
        │  │  Read/Send via API    │  │
        │  └───────────────────────┘  │
        └─────────────────────────────┘
```

---

## Database Schema

10 tables covering the full email lifecycle:

| Table | Purpose |
|-------|---------|
| `users` | User accounts (email, password hash, TOTP) |
| `mails` | Mail metadata (from, to, subject, folder, scores) |
| `mail_bodies` | Mail content (text, HTML, raw headers) |
| `attachments` | Attachment metadata (R2 references) |
| `labels` | User-defined labels (color, name) |
| `rules` | Mail processing rules (conditions → actions) |
| `agents` | API agents (for MCP/AI integration) |
| `webhooks` | Webhook endpoints (event subscriptions) |
| `audit_logs` | Audit trail (who did what, when) |
| `login_history` | Login attempts (success/failure, IP) |

---

## Development Guide

### Project Structure

```
missive-mail/
├── src/
│   ├── worker.ts          # Main worker entry (Hono app + email handler)
│   ├── schema/
│   │   └── index.ts       # Drizzle ORM schema definitions
│   ├── lib/
│   │   ├── auth.ts        # JWT, password hashing, API keys
│   │   └── db.ts          # D1 database connection
│   └── routes/
│       ├── auth.ts        # Authentication routes
│       ├── mails.ts       # Mail CRUD routes
│       ├── agents.ts      # Agent management routes
│       ├── webhooks.ts    # Webhook management routes
│       └── admin.ts       # Admin routes
├── web/                   # React frontend
│   ├── src/
│   └── dist/              # Build output (served by Worker)
├── migrations/
│   └── 0000_init.sql      # Database migration
├── scripts/
│   ├── deploy.sh          # One-click deployment
│   └── setup-email.sh     # Email routing setup
├── test/
│   ├── schema.test.ts     # Schema tests
│   ├── auth.test.ts       # Auth module tests
│   └── spam.test.ts       # Spam filtering tests
├── vitest.config.ts       # Test configuration
├── wrangler.toml          # Cloudflare Worker config
└── package.json
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start local development server |
| `npm run deploy` | Deploy Worker to Cloudflare |
| `npm run db:generate` | Generate Drizzle migration files |
| `npm run db:migrate` | Apply D1 migrations |
| `npm run db:studio` | Open Drizzle Studio |
| `npm test` | Run tests with Vitest |
| `npm run build:web` | Build React frontend |

### Adding a New Route

1. Create `src/routes/my-route.ts`
2. Define a Hono router: `const router = new Hono<{ Bindings: Env }>()`
3. Register in `src/worker.ts`: `app.route("/api/v1/my-route", myRoute)`

### Adding a New Table

1. Define in `src/schema/index.ts`
2. Run `npm run db:generate`
3. Apply migration: `npm run db:migrate`

---

## License

MIT
