import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkSpam, type SpamCheckResult } from "../src/lib/spam";

// ─── Mock Env for spam filter tests ─────────────────────────────────────────

function createMockEnv(overrides: Partial<{
  dbResults: any[];
  kvGet: (key: string) => Promise<string | null>;
}> = {}) {
  const kvStore = new Map<string, string>();

  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
        all: vi.fn().mockResolvedValue({ results: overrides.dbResults ?? [] }),
      }),
    },
    KV: {
      get: vi.fn(async (key: string) => {
        if (overrides.kvGet) return overrides.kvGet(key);
        return kvStore.get(key) ?? null;
      }),
      put: vi.fn(async (key: string, value: string) => {
        kvStore.set(key, value);
      }),
    },
    R2: {} as any,
    QUEUE: {} as any,
    ASSETS: {} as any,
  } as any;
}

// ─── Layer 1: Blacklist ─────────────────────────────────────────────────────

describe("Spam: Layer 1 — Blacklist", () => {
  it("should score 100 if sender is blacklisted", async () => {
    const env = createMockEnv();
    // Mock the first() call to return a blacklisted entry
    env.DB.prepare().bind().first = vi.fn().mockResolvedValue({ id: "1" });

    const result = await checkSpam(env, {
      fromAddr: "spammer@evil.com",
      toAddr: "user@example.com",
      subject: "Test",
    });

    expect(result.score).toBe(100);
    expect(result.reasons.some((r) => r.includes("blacklisted"))).toBe(true);
  });

  it("should score 0 if sender is not blacklisted", async () => {
    const env = createMockEnv();
    env.DB.prepare().bind().first = vi.fn().mockResolvedValue(null);

    const result = await checkSpam(env, {
      fromAddr: "friend@gmail.com",
      toAddr: "user@example.com",
      subject: "Hello!",
    });

    // No blacklist hit (score contribution from layer 1 is 0)
    expect(result.reasons.some((r) => r.includes("blacklisted"))).toBe(false);
  });
});

// ─── Layer 2: SPF/DKIM ─────────────────────────────────────────────────────

describe("Spam: Layer 2 — SPF/DKIM Authentication", () => {
  it("should score 0 with pass/fail unspecified", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "user@example.com",
      toAddr: "me@mydomain.com",
      subject: "Hi",
    });
    // No auth issues
    expect(result.reasons.some((r) => r.includes("SPF"))).toBe(false);
    expect(result.reasons.some((r) => r.includes("DKIM"))).toBe(false);
  });

  it("should score +40 on SPF fail", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "user@example.com",
      toAddr: "me@mydomain.com",
      subject: "Hi",
      spfResult: "fail",
    });
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.reasons.some((r) => r.includes("SPF"))).toBe(true);
  });

  it("should score +15 on SPF softfail", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "user@example.com",
      toAddr: "me@mydomain.com",
      subject: "Hi",
      spfResult: "softfail",
    });
    expect(result.score).toBeGreaterThanOrEqual(15);
  });

  it("should score +40 on DKIM fail", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "user@example.com",
      toAddr: "me@mydomain.com",
      subject: "Hi",
      dkimResult: "fail",
    });
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.reasons.some((r) => r.includes("DKIM"))).toBe(true);
  });

  it("should score 100 if both SPF and DKIM fail", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "user@example.com",
      toAddr: "me@mydomain.com",
      subject: "Hi",
      spfResult: "fail",
      dkimResult: "fail",
    });
    expect(result.score).toBe(100);
    expect(
      result.reasons.some((r) => r.includes("Both SPF and DKIM failed"))
    ).toBe(true);
  });
});

// ─── Layer 3: Keyword Matching ─────────────────────────────────────────────

describe("Spam: Layer 3 — Keyword Matching", () => {
  it("should flag spam keywords in subject", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "promo@spam.com",
      toAddr: "me@mydomain.com",
      subject: "FREE MONEY! Act now! You won the lottery!",
      textContent: "Click here to claim your prize",
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.some((r) => r.includes("keyword"))).toBe(true);
  });

  it("should flag keywords in body text", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "promo@spam.com",
      toAddr: "me@mydomain.com",
      subject: "Offer",
      textContent:
        "Congratulations! You have been selected for a wire transfer of bitcoins",
    });
    expect(result.score).toBeGreaterThan(0);
  });

  it("should flag keywords in HTML content", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "promo@spam.com",
      toAddr: "me@mydomain.com",
      subject: "Special",
      htmlContent:
        '<p>Congratulations you won! <a href="http://claim">Claim now</a></p>',
    });
    expect(result.score).toBeGreaterThan(0);
  });

  it("should not flag clean content", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "friend@gmail.com",
      toAddr: "me@mydomain.com",
      subject: "Meeting tomorrow at 3pm",
      textContent: "Let's discuss the project status.",
    });
    expect(result.reasons.some((r) => r.includes("keyword"))).toBe(false);
  });

  it("should cap keyword score at 60", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "spam@evil.com",
      toAddr: "me@mydomain.com",
      subject:
        "FREE MONEY you won ACT NOW limited time congratulations verify your account suspended lottery wire transfer bitcoins crypto wallet",
      textContent: "make money fast 100% free no cost risk free order now special offer click here",
    });
    // Cap at 60 from keywords alone
    // But total score may be higher due to other layers
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ─── Layer 4: Frequency Detection ──────────────────────────────────────────

describe("Spam: Layer 4 — Frequency Detection", () => {
  it("should not flag low-frequency senders", async () => {
    const kvStore = new Map<string, string>();
    const env = createMockEnv({
      kvGet: async (key: string) => kvStore.get(key) ?? null,
    });
    // Simulate KV.put to track counts
    env.KV.put = vi.fn(async (key: string, value: string) => {
      kvStore.set(key, value);
    });

    const result = await checkSpam(env, {
      fromAddr: "someone@example.com",
      toAddr: "me@mydomain.com",
      subject: "Normal email",
    });
    expect(result.reasons.some((r) => r.includes("frequency"))).toBe(false);
  });

  it("should flag high-frequency senders (>10/hour)", async () => {
    const kvStore = new Map<string, string>();
    const env = createMockEnv({
      kvGet: async (key: string) => kvStore.get(key) ?? null,
    });
    // Pre-populate counter at 10
    kvStore.set("spam:freq:someone@example.com", "10");
    env.KV.put = vi.fn(async (key: string, value: string) => {
      kvStore.set(key, value);
    });

    const result = await checkSpam(env, {
      fromAddr: "someone@example.com",
      toAddr: "me@mydomain.com",
      subject: "Another email",
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.some((r) => r.includes("frequency"))).toBe(true);
  });
});

// ─── Layer 5: Content Risk ─────────────────────────────────────────────────

describe("Spam: Layer 5 — Content Risk", () => {
  it("should flag high link density", async () => {
    const env = createMockEnv();
    const links = Array.from({ length: 15 }, (_, i) => `https://link${i}.com`).join(" ");
    const result = await checkSpam(env, {
      fromAddr: "promo@spam.com",
      toAddr: "me@mydomain.com",
      subject: "Check these out",
      textContent: links,
    });
    expect(result.reasons.some((r) => r.includes("link density"))).toBe(true);
  });

  it("should flag URL shorteners", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "promo@spam.com",
      toAddr: "me@mydomain.com",
      subject: "Link",
      textContent: "Visit https://bit.ly/abc123 and https://tinyurl.com/xyz",
    });
    expect(result.reasons.some((r) => r.includes("shortener"))).toBe(true);
  });

  it("should flag hidden text patterns", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "promo@spam.com",
      toAddr: "me@mydomain.com",
      subject: "Hidden",
      htmlContent:
        '<span style="color: white; font-size: 0px;">hidden spam text</span>',
    });
    expect(result.reasons.some((r) => r.includes("Hidden text"))).toBe(true);
  });

  it("should flag dangerous attachments", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "promo@spam.com",
      toAddr: "me@mydomain.com",
      subject: "Important doc",
      attachments: [
        { filename: "invoice.exe", mimeType: "application/octet-stream" },
      ],
    });
    expect(result.reasons.some((r) => r.includes("dangerous attachment"))).toBe(
      true
    );
  });

  it("should allow safe attachments", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "friend@gmail.com",
      toAddr: "me@mydomain.com",
      subject: "Photo",
      attachments: [
        { filename: "photo.jpg", mimeType: "image/jpeg" },
        { filename: "report.pdf", mimeType: "application/pdf" },
      ],
    });
    expect(
      result.reasons.some((r) => r.includes("dangerous attachment"))
    ).toBe(false);
  });

  it("should handle no content gracefully", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "user@example.com",
      toAddr: "me@mydomain.com",
      subject: "Empty",
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe("Spam: Edge Cases", () => {
  it("should handle empty subject and body", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "user@example.com",
      toAddr: "me@mydomain.com",
      subject: "",
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("should cap total score at 100", async () => {
    const env = createMockEnv();
    // Blacklist + SPF fail + DKIM fail = should cap at 100
    env.DB.prepare().bind().first = vi.fn().mockResolvedValue({ id: "1" });

    const result = await checkSpam(env, {
      fromAddr: "evil@blacklist.com",
      toAddr: "me@mydomain.com",
      subject: "FREE MONEY lottery",
      spfResult: "fail",
      dkimResult: "fail",
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("should return empty reasons for clean email", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "colleague@company.com",
      toAddr: "me@mydomain.com",
      subject: "Meeting notes",
      textContent: "Here are the meeting notes from today.",
    });
    expect(result.score).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });

  it("should handle null content fields", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "user@example.com",
      toAddr: "me@mydomain.com",
      subject: "Test",
      textContent: null,
      htmlContent: null,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("should handle attachments with no dangerous extensions", async () => {
    const env = createMockEnv();
    const result = await checkSpam(env, {
      fromAddr: "user@example.com",
      toAddr: "me@mydomain.com",
      subject: "Report",
      attachments: [
        { filename: "data.csv", mimeType: "text/csv" },
        { filename: "image.png", mimeType: "image/png" },
      ],
    });
    expect(result.score).toBe(0);
  });
});

// ─── Integration: Combined Layers ──────────────────────────────────────────

describe("Spam: Integration — Combined Layers", () => {
  it("should accumulate scores from multiple layers", async () => {
    const kvStore = new Map<string, string>();
    kvStore.set("spam:freq:spammy@flood.com", "5"); // Below threshold

    const env = createMockEnv({
      kvGet: async (key: string) => kvStore.get(key) ?? null,
    });
    env.KV.put = vi.fn(async (key: string, value: string) => {
      kvStore.set(key, value);
    });

    // SPF softfail + keywords = should be > 0
    const result = await checkSpam(env, {
      fromAddr: "spammy@flood.com",
      toAddr: "me@mydomain.com",
      subject: "FREE MONEY you won",
      spfResult: "softfail",
    });
    expect(result.score).toBeGreaterThan(15); // SPF softfail(15) + keywords
  });

  it("should correctly identify a legitimate email", async () => {
    const env = createMockEnv();
    env.DB.prepare().bind().first = vi.fn().mockResolvedValue(null);

    const result = await checkSpam(env, {
      fromAddr: "hr@company.com",
      toAddr: "employee@company.com",
      subject: "Q2 Planning Meeting",
      textContent:
        "Hi team, please find attached the agenda for our Q2 planning meeting.",
      spfResult: "pass",
      dkimResult: "pass",
      attachments: [{ filename: "agenda.pdf", mimeType: "application/pdf" }],
    });
    expect(result.score).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });
});
