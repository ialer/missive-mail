import { Context, Next } from "hono";
import type { Env } from "../worker";

// ─── ID Generation (cuid-like) ──────────────────────────────────────────────
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("");
  return `c${timestamp}${randomPart}`;
}

// ─── JWT Implementation ──────────────────────────────────────────────────────
// Simple JWT sign/verify using Web Crypto API.
// For production, consider using jose library.

interface JwtPayload {
  sub: string; // user id
  email: string;
  iat: number;
  exp: number;
  type?: "access" | "refresh";
}

function base64UrlEncode(data: string): string {
  return btoa(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(data: string): string {
  let base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  return atob(base64);
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return base64UrlEncode(binary);
}

function getSecretKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signJwt(
  payload: Omit<JwtPayload, "iat" | "exp">,
  secret: string,
  expiresInMs: number = 60 * 60 * 1000 // 1 hour default
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: Math.floor((now * 1000 + expiresInMs) / 1000),
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const dataToSign = `${headerB64}.${payloadB64}`;

  const key = await getSecretKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(dataToSign)
  );

  const signatureB64 = base64UrlEncodeBytes(new Uint8Array(signature));
  return `${dataToSign}.${signatureB64}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const dataToVerify = `${headerB64}.${payloadB64}`;

    const key = await getSecretKey(secret);
    // Decode signature from base64url to bytes (no double-decode)
    let sigBase64 = signatureB64.replace(/-/g, "+").replace(/_/g, "/");
    while (sigBase64.length % 4) sigBase64 += "=";
    const signatureBytes = Uint8Array.from(
      atob(sigBase64),
      (c) => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(dataToVerify)
    );

    if (!valid) return null;

    const payload: JwtPayload = JSON.parse(base64UrlDecode(payloadB64));

    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ─── Password Hashing ────────────────────────────────────────────────────────
// Uses SHA-256 with salt via Web Crypto API.
// NOTE: For production, use bcrypt/argon2id via a WASM implementation.
// SHA-256 is NOT suitable for password hashing in production.
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const encoder = new TextEncoder();

  // Create a combined buffer: salt + password
  const data = new Uint8Array(salt.length + encoder.encode(password).length);
  data.set(salt);
  data.set(encoder.encode(password), salt.length);

  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);

  // Format: $sha256$<salt_hex>$<hash_hex>
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashHex = Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `$sha256$${saltHex}$${hashHex}`;
}

export async function comparePassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split("$");
    if (parts.length !== 4 || parts[1] !== "sha256") {
      return false;
    }

    const saltHex = parts[2];
    const expectedHash = parts[3];

    const salt = new Uint8Array(
      saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    const encoder = new TextEncoder();
    const data = new Uint8Array(salt.length + encoder.encode(password).length);
    data.set(salt);
    data.set(encoder.encode(password), salt.length);

    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return hashHex === expectedHash;
  } catch {
    return false;
  }
}

// ─── API Key Verification ────────────────────────────────────────────────────
export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(apiKey));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyApiKey(apiKey: string, storedHash: string): Promise<boolean> {
  const hash = await hashApiKey(apiKey);
  return hash === storedHash;
}

// ─── Ctx Variables ──────────────────────────────────────────────────────────
export interface AuthVariables {
  userId: string;
  email: string;
  jwtPayload: JwtPayload;
}

// ─── Auth Middleware (JWT) ───────────────────────────────────────────────────
export function authMiddleware() {
  return async (c: Context<{ Bindings: Env; Variables: AuthVariables }>, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.slice(7);
    const secret = c.env.JWT_SECRET || "dev-secret-change-me";
    const payload = await verifyJwt(token, secret);

    if (!payload || payload.type === "refresh") {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    c.set("userId", payload.sub);
    c.set("email", payload.email);
    c.set("jwtPayload", payload);

    await next();
  };
}

// ─── Agent Auth Middleware (X-Agent-Token) ───────────────────────────────────
export function agentAuthMiddleware() {
  return async (c: Context<{ Bindings: Env; Variables: AuthVariables }>, next: Next) => {
    const agentToken = c.req.header("X-Agent-Token");
    if (!agentToken) {
      return c.json({ error: "Missing X-Agent-Token header" }, 401);
    }

    const { getDb, eq } = await import("./db");
    const { agents } = await import("../schema");
    const db = getDb(c.env);

    // Find agent by comparing token hash
    const tokenHash = await hashApiKey(agentToken);
    const agentResults = await db
      .select()
      .from(agents)
      .where(eq(agents.apiKeyHash, tokenHash))
      .limit(1);

    if (agentResults.length === 0) {
      return c.json({ error: "Invalid agent token" }, 401);
    }

    const agent = agentResults[0];
    if (!agent.enabled) {
      return c.json({ error: "Agent is disabled" }, 403);
    }

    // Set userId as the agent's owner
    c.set("userId", agent.userId);
    c.set("email", `agent:${agent.id}`);

    // Attach agent info to context for permission checking
    c.set("jwtPayload", {
      sub: agent.userId,
      email: `agent:${agent.id}`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      type: "access",
    });

    await next();
  };
}
