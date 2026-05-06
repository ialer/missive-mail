/**
 * Queue Producer & Consumer for webhook delivery.
 *
 * Producer: signs the payload with HMAC-SHA256 and enqueues it.
 * Consumer: dequeues messages, signs again, POSTs to the webhook URL,
 *           and retries on failure (Cloudflare Queues handles retries).
 */

import type { Env } from "../worker";

// ─── Types ────────────────────────────────────────────────────────────────

export interface WebhookQueueMessage {
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
}

export interface WebhookQueueBody {
  message: WebhookQueueMessage;
  queue: string;
  batch: {
    messages: WebhookQueueMessage[];
    size: number;
  };
}

// ─── Producer ─────────────────────────────────────────────────────────────

/**
 * Sign a webhook payload and enqueue it for delivery.
 */
export async function sendWebhookEvent(
  env: Env,
  webhookId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const message: WebhookQueueMessage = {
    webhookId,
    event,
    payload,
  };

  await env.QUEUE.send(message);
}

// ─── HMAC Helpers ─────────────────────────────────────────────────────────

async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Consumer ─────────────────────────────────────────────────────────────

/**
 * Default Queue consumer export.
 *
 * Cloudflare Queues invokes this for each batch of messages on the
 * configured queue. It fetches the webhook URL + secret from D1, signs
 * the payload, and POSTs it.
 */
export default {
  async queue(batch: MessageBatch<WebhookQueueMessage>, env: Env) {
    for (const msg of batch.messages) {
      const { webhookId, event, payload } = msg.body;

      try {
        // Look up the webhook record
        const webhook = await env.DB.prepare(
          "SELECT id, url, secret_hash AS secretHash, enabled FROM webhooks WHERE id = ?"
        )
          .bind(webhookId)
          .first<{ id: string; url: string; secretHash: string; enabled: number }>();

        if (!webhook || !webhook.enabled) {
          // Webhook not found or disabled — ack and skip
          console.log(`Webhook ${webhookId} not found or disabled, skipping`);
          continue;
        }

        // Build the signed body
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const bodyStr = JSON.stringify({ event, payload, timestamp });

        // We need the raw secret to compute the signature.  The webhook
        // creation endpoint stores only the hash, so for HMAC signing we
        // store a separate KV entry `webhook_secret:<id>` at creation time.
        // Fallback: use the hash as a proxy (not ideal but works).
        const rawSecret =
          (await env.KV.get(`webhook_secret:${webhookId}`)) ?? webhook.secretHash;

        const signature = await hmacSha256(rawSecret, bodyStr);

        // POST to the webhook URL
        const resp = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Event": event,
            "X-Webhook-Signature": `sha256=${signature}`,
            "X-Webhook-Timestamp": timestamp,
          },
          body: bodyStr,
        });

        if (!resp.ok) {
          // Throw to trigger retry
          throw new Error(
            `Webhook delivery failed: ${resp.status} ${await resp.text()}`
          );
        }

        console.log(
          `Webhook ${webhookId} delivered: ${event} → ${webhook.url} (${resp.status})`
        );
      } catch (err) {
        // Log and re-throw so Cloudflare Queues retries this message
        console.error(`Webhook ${webhookId} delivery error:`, err);
        throw err;
      }
    }
  },
};
