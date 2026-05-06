/**
 * 5-Layer Spam Filter for incoming emails.
 *
 * Layer 1: Blacklist check (D1 blacklist table)
 * Layer 2: SPF / DKIM results (from Cloudflare Email Worker)
 * Layer 3: Keyword matching (D1 rules table)
 * Layer 4: Frequency detection (KV counter — >10 emails/hour from same sender)
 * Layer 5: Content risk scoring (suspicious links / attachments)
 *
 * Returns a spam score 0–100 and the list of reasons that contributed.
 */

import type { Env } from "../worker";

export interface SpamCheckResult {
  /** Spam score from 0 (clean) to 100 (certain spam). */
  score: number;
  /** Human-readable reasons for the score. */
  reasons: string[];
}

interface SpamCheckInput {
  fromAddr: string;
  toAddr: string;
  subject: string;
  textContent?: string | null;
  htmlContent?: string | null;
  attachments?: { filename: string; mimeType: string }[];
  spfResult?: "pass" | "fail" | "softfail" | "neutral" | "none" | "unknown";
  dkimResult?: "pass" | "fail" | "unknown";
}

// ─── Dangerous file extensions ────────────────────────────────────────────
const DANGEROUS_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".pif",
  ".vbs",
  ".js",
  ".ws",
  ".wsh",
  ".ps1",
  ".msi",
  ".jar",
  ".php",
  ".rb",
  ".py",
  ".sh",
  ".deb",
  ".rpm",
  ".apk",
]);

// ─── Spam keywords (configurable) ────────────────────────────────────────
const DEFAULT_SPAM_KEYWORDS = [
  "free money",
  "you won",
  "act now",
  "limited time",
  "click here",
  "congratulations",
  "urgent action required",
  "verify your account",
  "suspended",
  "lottery",
  "nigerian prince",
  "wire transfer",
  "bitcoins",
  "crypto wallet",
  "make money fast",
  "100% free",
  "no cost",
  "risk free",
  "order now",
  "special offer",
];

// ─── Layer implementations ────────────────────────────────────────────────

/**
 * Layer 1: Check sender against the blacklist table in D1.
 */
async function layer1_blacklist(
  env: Env,
  fromAddr: string
): Promise<{ score: number; reason: string | null }> {
  try {
    const blocked = await env.DB.prepare(
      "SELECT id FROM blacklist WHERE value = ? OR value = ? LIMIT 1"
    )
      .bind(fromAddr.toLowerCase(), fromAddr.split("@")[1]?.toLowerCase() ?? "")
      .first();

    if (blocked) {
      return { score: 100, reason: `Sender/domain blacklisted: ${fromAddr}` };
    }
  } catch {
    // Table may not exist yet — treat as no match
  }
  return { score: 0, reason: null };
}

/**
 * Layer 2: Evaluate SPF and DKIM authentication results.
 */
function layer2_auth(
  spfResult?: string,
  dkimResult?: string
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (spfResult === "fail") {
    score += 40;
    reasons.push("SPF check failed");
  } else if (spfResult === "softfail") {
    score += 15;
    reasons.push("SPF softfail");
  }

  if (dkimResult === "fail") {
    score += 40;
    reasons.push("DKIM check failed");
  }

  if (spfResult === "fail" && dkimResult === "fail") {
    score = 100; // Both failing is almost certainly spam
    reasons.push("Both SPF and DKIM failed — definite spam");
  }

  return { score, reasons };
}

/**
 * Layer 3: Match subject/body against spam keyword rules from D1.
 */
async function layer3_keywords(
  env: Env,
  subject: string,
  textContent?: string | null,
  htmlContent?: string | null
): Promise<{ score: number; reasons: string[] }> {
  let score = 0;
  const reasons: string[] = [];

  // Combine all text
  const combined = [
    subject,
    textContent ?? "",
    htmlContent ?? "",
  ]
    .join(" ")
    .toLowerCase();

  // Check D1 rules table for custom spam keywords
  let spamKeywords = DEFAULT_SPAM_KEYWORDS;
  try {
    const { results } = await env.DB.prepare(
      "SELECT conditions FROM rules WHERE name LIKE '%spam%' AND enabled = 1"
    ).all<{ conditions: string }>();

    for (const row of results) {
      try {
        const conds = JSON.parse(row.conditions);
        if (Array.isArray(conds.keywords)) {
          spamKeywords = [...spamKeywords, ...conds.keywords.map(String)];
        }
      } catch {
        // ignore parse errors
      }
    }
  } catch {
    // rules table may not exist
  }

  let keywordHits = 0;
  for (const kw of spamKeywords) {
    if (combined.includes(kw.toLowerCase())) {
      keywordHits++;
    }
  }

  if (keywordHits > 0) {
    score = Math.min(60, keywordHits * 12);
    reasons.push(`Matched ${keywordHits} spam keyword(s)`);
  }

  return { score, reasons };
}

/**
 * Layer 4: Frequency check — >10 emails/hour from the same sender is suspicious.
 */
async function layer4_frequency(
  env: Env,
  fromAddr: string
): Promise<{ score: number; reasons: string[] }> {
  const key = `spam:freq:${fromAddr.toLowerCase()}`;
  const windowSeconds = 3600; // 1 hour
  const limit = 10;

  try {
    const raw = await env.KV.get(key);
    const current = raw ? Number(raw) || 0 : 0;
    const next = current + 1;

    await env.KV.put(key, String(next), {
      expirationTtl: windowSeconds,
    });

    if (next > limit) {
      const excess = next - limit;
      const penalty = Math.min(40, excess * 5);
      return {
        score: penalty,
        reasons: [
          `High frequency: ${next} emails from ${fromAddr} in ${windowSeconds}s (limit: ${limit})`,
        ],
      };
    }
  } catch {
    // KV may not be configured
  }

  return { score: 0, reasons: [] };
}

/**
 * Layer 5: Content risk assessment — links, attachments, formatting.
 */
function layer5_content(
  textContent?: string | null,
  htmlContent?: string | null,
  attachments?: { filename: string; mimeType: string }[]
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const content = [textContent ?? "", htmlContent ?? ""].join(" ");

  // Count links
  const urlCount = (content.match(/https?:\/\//gi) ?? []).length;
  if (urlCount > 10) {
    score += 15;
    reasons.push(`High link density: ${urlCount} URLs found`);
  }

  // Check for shortened URLs (bit.ly, tinyurl, t.co, etc.)
  const shortenerCount = (
    content.match(
      /https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|buff\.ly|ow\.ly)\//gi
    ) ?? []
  ).length;
  if (shortenerCount > 0) {
    score += 10 * shortenerCount;
    reasons.push(`${shortenerCount} URL shortener(s) detected`);
  }

  // Check for hidden text (white-on-white, tiny font, etc.)
  if (
    htmlContent &&
    /color:\s*(white|#fff|#ffffff|#00000000)/gi.test(htmlContent) &&
    /font-size:\s*[0-2]px/gi.test(htmlContent)
  ) {
    score += 25;
    reasons.push("Hidden text detected (steganography pattern)");
  }

  // Check attachments
  if (attachments && attachments.length > 0) {
    let dangerousCount = 0;
    for (const att of attachments) {
      const ext = att.filename
        .substring(att.filename.lastIndexOf("."))
        .toLowerCase();
      if (DANGEROUS_EXTENSIONS.has(ext)) {
        dangerousCount++;
      }
    }
    if (dangerousCount > 0) {
      score += 25 * dangerousCount;
      reasons.push(
        `${dangerousCount} dangerous attachment(s) detected`
      );
    }
  }

  return { score: Math.min(score, 100), reasons };
}

// ─── Main entry point ─────────────────────────────────────────────────────

/**
 * Run all 5 spam filter layers and return the aggregated result.
 */
export async function checkSpam(
  env: Env,
  input: SpamCheckInput
): Promise<SpamCheckResult> {
  const allReasons: string[] = [];
  let totalScore = 0;

  // Layer 1: Blacklist
  const l1 = await layer1_blacklist(env, input.fromAddr);
  totalScore += l1.score;
  if (l1.reason) allReasons.push(l1.reason);

  // Layer 2: Auth (SPF / DKIM)
  const l2 = layer2_auth(input.spfResult, input.dkimResult);
  totalScore += l2.score;
  allReasons.push(...l2.reasons);

  // Layer 3: Keywords
  const l3 = await layer3_keywords(env, input.subject, input.textContent, input.htmlContent);
  totalScore += l3.score;
  allReasons.push(...l3.reasons);

  // Layer 4: Frequency
  const l4 = await layer4_frequency(env, input.fromAddr);
  totalScore += l4.score;
  allReasons.push(...l4.reasons);

  // Layer 5: Content
  const l5 = layer5_content(input.textContent, input.htmlContent, input.attachments);
  totalScore += l5.score;
  allReasons.push(...l5.reasons);

  return {
    score: Math.min(totalScore, 100),
    reasons: allReasons,
  };
}
