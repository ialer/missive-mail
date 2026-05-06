/**
 * Cloudflare Turnstile CAPTCHA verification.
 *
 * Verifies a Turnstile token by calling the Cloudflare siteverify endpoint.
 * Used on public-facing forms (signup, login, contact) to prevent bots.
 */

import type { Env } from "../worker";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Turnstile token.
 *
 * @param env    Worker environment (needs TURNSTILE_SECRET_KEY secret)
 * @param token  The turnstile token from the client-side widget
 * @param ip     The visitor's IP address (optional, improves validation)
 * @returns `true` if verification succeeded, `false` otherwise
 */
export async function verifyTurnstile(
  env: Env,
  token: string,
  ip?: string
): Promise<boolean> {
  const secretKey = env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.error("TURNSTILE_SECRET_KEY not configured");
    return false;
  }

  const formData = new FormData();
  formData.append("secret", secretKey);
  formData.append("response", token);
  if (ip) {
    formData.append("remoteip", ip);
  }

  try {
    const resp = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: formData,
    });

    if (!resp.ok) {
      console.error(`Turnstile verify failed: ${resp.status}`);
      return false;
    }

    const result = (await resp.json()) as {
      success: boolean;
      challenge_ts?: string;
      hostname?: string;
      "error-codes"?: string[];
    };

    if (!result.success) {
      console.warn(
        "Turnstile verification failed:",
        result["error-codes"]?.join(", ") ?? "unknown"
      );
    }

    return result.success === true;
  } catch (err) {
    console.error("Turnstile verify error:", err);
    return false;
  }
}
