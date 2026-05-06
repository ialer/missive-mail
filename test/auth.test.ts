import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  signJwt,
  verifyJwt,
  hashPassword,
  comparePassword,
  hashApiKey,
  verifyApiKey,
  generateId,
} from "../src/lib/auth";

// ─── JWT ────────────────────────────────────────────────────────────────────

describe("Auth: JWT sign/verify", () => {
  const SECRET = "test-jwt-secret-key-for-unit-tests";

  it("should sign and verify a valid JWT", async () => {
    const token = await signJwt(
      { sub: "user-123", email: "test@example.com" },
      SECRET
    );
    expect(token).toBeTruthy();
    expect(token.split(".")).toHaveLength(3);

    const payload = await verifyJwt(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-123");
    expect(payload!.email).toBe("test@example.com");
    // type is undefined when not explicitly set in signJwt
    expect(payload!.type).toBeUndefined();
  });

  it("should return null for invalid signature", async () => {
    const token = await signJwt(
      { sub: "user-123", email: "test@example.com" },
      SECRET
    );
    const result = await verifyJwt(token, "wrong-secret");
    expect(result).toBeNull();
  });

  it("should return null for malformed token", async () => {
    expect(await verifyJwt("not.a.jwt", SECRET)).toBeNull();
    expect(await verifyJwt("invalid", SECRET)).toBeNull();
    expect(await verifyJwt("", SECRET)).toBeNull();
  });

  it("should return null for expired token", async () => {
    const token = await signJwt(
      { sub: "user-123", email: "test@example.com" },
      SECRET,
      -1000 // expired 1 second ago
    );
    const result = await verifyJwt(token, SECRET);
    expect(result).toBeNull();
  });

  it("should set custom expiration", async () => {
    const token = await signJwt(
      { sub: "user-123", email: "test@example.com" },
      SECRET,
      60 * 60 * 1000 // 1 hour
    );
    const payload = await verifyJwt(token, SECRET);
    expect(payload).not.toBeNull();
    const now = Math.floor(Date.now() / 1000);
    expect(payload!.exp).toBeGreaterThan(now);
  });

  it("should reject refresh tokens via authMiddleware convention", async () => {
    const token = await signJwt(
      { sub: "user-123", email: "test@example.com", type: "refresh" },
      SECRET
    );
    const payload = await verifyJwt(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe("refresh");
    // authMiddleware would reject this, but verifyJwt itself succeeds
  });
});

// ─── Password Hashing ──────────────────────────────────────────────────────

describe("Auth: password hash/compare", () => {
  it("should hash a password", async () => {
    const hash = await hashPassword("mypassword123");
    expect(hash).toMatch(/^\$sha256\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  });

  it("should produce different hashes for same password (salt)", async () => {
    const hash1 = await hashPassword("mypassword123");
    const hash2 = await hashPassword("mypassword123");
    expect(hash1).not.toBe(hash2);
  });

  it("should compare correct password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await comparePassword("correct-horse-battery-staple", hash)).toBe(
      true
    );
  });

  it("should reject wrong password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await comparePassword("wrong-password", hash)).toBe(false);
  });

  it("should handle invalid hash format", async () => {
    expect(await comparePassword("password", "not-a-hash")).toBe(false);
    expect(await comparePassword("password", "")).toBe(false);
    expect(await comparePassword("password", "$md5$abc$def")).toBe(false);
  });

  it("should handle empty password", async () => {
    const hash = await hashPassword("");
    expect(await comparePassword("", hash)).toBe(true);
    expect(await comparePassword(" ", hash)).toBe(false);
  });
});

// ─── API Key ────────────────────────────────────────────────────────────────

describe("Auth: API key hash/verify", () => {
  it("should hash an API key", async () => {
    const key = "mk_test_abc123def456";
    const hash = await hashApiKey(key);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should produce deterministic hash (no salt)", async () => {
    const key = "mk_test_abc123def456";
    const hash1 = await hashApiKey(key);
    const hash2 = await hashApiKey(key);
    expect(hash1).toBe(hash2);
  });

  it("should verify correct API key", async () => {
    const key = "mk_prod_xyz789";
    const hash = await hashApiKey(key);
    expect(await verifyApiKey(key, hash)).toBe(true);
  });

  it("should reject wrong API key", async () => {
    const key = "mk_prod_xyz789";
    const hash = await hashApiKey(key);
    expect(await verifyApiKey("mk_prod_wrong", hash)).toBe(false);
  });
});

// ─── ID Generation ─────────────────────────────────────────────────────────

describe("Auth: generateId", () => {
  it("should generate unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it("should start with 'c' prefix", () => {
    const id = generateId();
    expect(id.startsWith("c")).toBe(true);
  });

  it("should have reasonable length", () => {
    const id = generateId();
    expect(id.length).toBeGreaterThan(10);
    expect(id.length).toBeLessThan(100);
  });
});
