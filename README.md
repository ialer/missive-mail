# 📬 missive-mail

> **面向 Agent 的邮件信息通道** — 让 AI 通过 MCP/REST/Webhook 读取、处理、代发邮件

missive-mail 不只是邮件客户端。它是 Agent 连接现实世界的基础设施——邮件是全球最通用的协议，所有服务都能发邮件。missive-mail 让 Agent 成为你的收发室。

```
GitHub 通知 → 收件箱 → Agent 自动创建 Issue
银行账单   → 收件箱 → Agent 归档 + 分析支出
服务器告警 → 收件箱 → Agent 推送到 Matrix 群
客户咨询   → 收件箱 → Agent 草稿回复 → 人工确认发送
```

---

## ⚡ 核心特性

### 🤖 Agent 原生接口

missive-mail 提供三种 Agent 接入方式，覆盖所有场景：

#### MCP Server（Model Context Protocol）

内置 McpAgent，基于 Cloudflare Agents SDK，每个 Agent 连接拥有独立 Durable Object + SQL 数据库：

```typescript
// Hermes / OpenClaw / 任何 MCP 客户端直接连接
const tools = await mcp.connect("https://missive-mail.ialer.workers.dev/mcp");

// 7 个内置 Tools
await tools.mail_list({ folder: "inbox", filter: "from:github.com" });
await tools.mail_read({ id: "msg_abc123" });
await tools.mail_send({ to: "user@example.com", subject: "Hi", body: "Hello!" });
await tools.mail_reply({ id: "msg_abc123", body: "收到，我会处理" });
await tools.mail_manage({ action: "archive", ids: ["msg_abc123"] });
await tools.mail_analyze({ filter: "last 7 days" });
await tools.mail_search({ query: "发票 OR invoice" });
```

**特性：**
- Streamable HTTP 传输（官方协议）
- 每个 Agent 连接有独立状态（记住上下文、缓存查询结果）
- 内置 OAuth 支持（可选）
- Agent 签名：`——由「{agent_name}」代发`

#### REST API

通用 Agent/脚本调用，X-Agent-Token 认证：

```bash
# Agent 认证（不使用 JWT，直接 API Key）
curl -H "X-Agent-Token: aam_xxxxxxxx" \
     https://missive-mail.ialer.workers.dev/api/v1/mails

# 发送邮件
curl -X POST -H "X-Agent-Token: aam_xxxxxxxx" \
     -H "Content-Type: application/json" \
     -d '{"to":"user@example.com","subject":"Report","text":"Daily summary..."}' \
     https://missive-mail.ialer.workers.dev/api/v1/mails/send
```

#### Webhook 事件推送

事件驱动，HMAC-SHA256 签名验证，Queue 异步投递 + 重试：

```json
// 注册 Webhook
POST /api/v1/webhooks
{
  "url": "https://your-agent.com/webhook",
  "events": ["mail.received", "mail.read", "mail.flagged"],
  "filter": { "importance": "high" },
  "secret": "your-webhook-secret"
}

// 推送格式
{
  "event": "mail.received",
  "timestamp": "2026-05-07T12:00:00Z",
  "mail": { "id": "...", "from": "alert@github.com", "subject": "Issue #42" },
  "signature": "hmac-sha256=..."
}
```

### 🔐 安全体系

| 层级 | 措施 |
|---|---|
| 认证 | JWT + Agent API Key + Turnstile CAPTCHA |
| 2FA | TOTP 双因素 + 恢复码 + 放宽策略 |
| 限流 | KV 滑动窗口（IP/用户/Agent 三级） |
| 加密 | PGP 端到端（浏览器端 openpgp.js） |
| 传输 | CF 自动 SPF/DKIM/DMARC + TLS |
| 审计 | D1 全操作日志 + 登录历史 |
| 垃圾过滤 | 5 层过滤链 |

### 🌐 双语界面

- 🇨🇳 中文（默认）/ 🇺🇸 English
- 300+ 翻译键，覆盖所有页面
- 顶栏一键切换，localStorage 记忆

### 📧 邮件能力

- **收信**: CF Email Routing（免费无限）+ postal-mime 解析
- **发信**: CF Email Service（3,000封/月免费）
- **存储**: D1 结构化 + R2 附件 + KV 缓存
- **追踪**: D1 原生已读 + MDN 回执 + 追踪像素
- **对话**: 气泡式邮件视图，Agent 代发标记

---

## 🏗 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    Cloudflare 边缘                        │
│                                                          │
│  ┌──────────────────┐  ┌──────────────────────────────┐  │
│  │  CF Email Worker │  │      Hono HTTP Worker         │  │
│  │  (收信入口)       │  │  REST API + Webhook + 静态资源│  │
│  └──────────────────┘  └──────────────────────────────┘  │
│                                                          │
│  ┌──────────────────┐  ┌──────────────────────────────┐  │
│  │  McpAgent (DO)   │  │       CF 全家桶存储            │  │
│  │  /mcp            │  │  D1 + KV + R2 + Queue         │  │
│  │  每Agent独立状态  │  │                               │  │
│  └──────────────────┘  └──────────────────────────────┘  │
│                                                          │
│  ┌──────────────────┐                                    │
│  │  CF Email Service│  ← 发信出口                        │
│  └──────────────────┘                                    │
└─────────────────────────────────────────────────────────┘
```

| 组件 | 技术 |
|---|---|
| 运行时 | Cloudflare Workers（$5/月付费计划） |
| HTTP | Hono |
| MCP | CF Agents SDK（McpAgent + Durable Object） |
| 数据库 | D1（SQLite）+ Drizzle ORM |
| 缓存 | KV（限流/会话/Token） |
| 存储 | R2（附件/静态资源） |
| 队列 | CF Queues（Webhook 异步投递 + DLQ） |
| 前端 | React + TailwindCSS + shadcn/ui |
| 国际化 | react-i18next（中/英） |
| 邮件解析 | postal-mime |
| PGP | openpgp.js v6（浏览器端） |
| 测试 | Vitest（70 tests） |

---

## 🚀 快速开始

### 前置条件

- Node.js ≥ 18
- Wrangler CLI ≥ 4
- Cloudflare 账户（Workers 付费计划）

### 本地开发

```bash
git clone https://github.com/ialer/missive-mail.git
cd missive-mail
npm install
cd web && npm install && cd ..

# 启动开发服务器
npm run dev

# 运行测试
npm test

# 构建前端
npm run build:web
```

### 一键部署

```bash
# 设置 Cloudflare 认证
export CLOUDFLARE_API_TOKEN=<your-token>

# 一键部署（创建 D1/KV/R2/Queue + 迁移 + 设置密钥 + 构建 + 部署）
bash scripts/deploy.sh
```

### 配置邮件路由

```bash
# 配置 CF Email Routing（需要在 CF Dashboard 操作）
bash scripts/setup-email.sh yourdomain.com
```

---

## 🔧 Agent 集成指南

### 接入 Hermes（AI Agent）

```yaml
# hermes config.yaml
mcp_servers:
  missive-mail:
    url: https://missive-mail.ialer.workers.dev/mcp
    transport: streamable-http
```

### 接入 OpenClaw

```json
{
  "mcpServers": {
    "missive-mail": {
      "url": "https://missive-mail.ialer.workers.dev/mcp",
      "transport": "streamable-http"
    }
  }
}
```

### 自定义 Agent 签名

```bash
# 创建 Agent 时设置签名模板
curl -X POST -H "X-Agent-Token: aam_xxxxxxxx" \
  -d '{"name":"my-agent","signature_template":"——由「{name}」代发"}' \
  https://missive-mail.ialer.workers.dev/api/v1/agents
```

### 权限矩阵

| 角色 | 读邮件 | 发邮件 | 回复 | 管理标签 | 删除 | 管账户 | 管规则 |
|---|---|---|---|---|---|---|---|
| 只读 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 助理 | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| 管理 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 全权 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 📊 MCP Tools 详细文档

### `mail_list`

列出邮件，支持文件夹过滤和分页。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| folder | string | 否 | inbox/sent/draft/archive/spam |
| filter | string | 否 | 全文搜索关键词 |
| page | number | 否 | 页码，默认 1 |

### `mail_read`

读取邮件完整内容，自动标记已读。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是 | 邮件 ID |

### `mail_send`

发送邮件。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| to | string | 是 | 收件人 |
| subject | string | 是 | 主题 |
| body | string | 是 | 正文 |
| cc | string | 否 | 抄送 |
| bcc | string | 否 | 密送 |
| signature | string | 否 | 自定义签名（覆盖默认） |

### `mail_reply`

回复邮件。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是 | 原邮件 ID |
| body | string | 是 | 回复正文 |
| signature | string | 否 | 自定义签名 |

### `mail_manage`

批量管理邮件。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| action | enum | 是 | archive/label/delete/star |
| ids | string[] | 是 | 邮件 ID 列表 |
| label | string | 否 | 标签名（action=label 时必填） |

### `mail_analyze`

邮件统计分析。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| filter | string | 否 | 时间范围过滤 |

### `mail_search`

全文搜索。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| query | string | 是 | 搜索关键词 |
| folder | string | 否 | 限定文件夹 |

---

## 📁 项目结构

```
missive-mail/
├── src/
│   ├── worker.ts              # Worker 入口（Hono + Email Handler）
│   ├── mcp/mail-mcp.ts        # McpAgent MCP Server（7 tools）
│   ├── schema/index.ts        # Drizzle ORM Schema（10 张表）
│   ├── lib/
│   │   ├── auth.ts            # JWT + 密码 + API Key
│   │   ├── db.ts              # D1 连接
│   │   ├── queue.ts           # Webhook Queue Producer/Consumer
│   │   ├── spam.ts            # 5 层垃圾过滤
│   │   ├── rate-limit.ts      # KV 滑动窗口限流
│   │   └── turnstile.ts       # Turnstile CAPTCHA
│   └── routes/
│       ├── auth.ts            # 认证路由
│       ├── mails.ts           # 邮件 CRUD
│       ├── agents.ts          # Agent 管理
│       ├── webhooks.ts        # Webhook 管理
│       └── admin.ts           # 管理后台
├── web/                       # React 前端（中/英双语）
├── migrations/                # D1 迁移 SQL
├── scripts/                   # 部署脚本
├── test/                      # 测试（70 tests）
└── wrangler.toml              # CF Workers 配置
```

---

## 🔑 环境变量

| 变量 | 说明 | 必填 |
|---|---|---|
| `JWT_SECRET` | JWT 签名密钥 | ✅ |
| `TURNSTILE_SECRET_KEY` | Turnstile CAPTCHA 密钥 | 可选 |
| `TURNSTILE_SITE_KEY` | Turnstile 前端 Key | 可选 |
| `CF_EMAIL_SERVICE_API_KEY` | CF Email Service API Key | 可选 |

---

## 💰 成本估算

| 服务 | 免费额度 | 预估用量 | 月费 |
|---|---|---|---|
| Workers | 10M 请求 | ~50K | $0 |
| D1 | 25B 读/50M 写 | ~100K | $0 |
| KV | 10M 读/1M 写 | ~200K | $0 |
| R2 | 10GB | <1GB | $0 |
| DO | 1M 请求 | ~10K | $0 |
| Queue | 1M 操作 | ~10K | $0 |
| CF Email Service | 3,000封/月 | ~500封 | $0 |
| **合计** | | | **$5/月** |

---

## 📜 License

MIT
