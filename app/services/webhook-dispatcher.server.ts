/**
 * Outbound webhook dispatcher
 *
 * Fires when an EventLog row is written. For each enabled
 * WebhookDestination whose `eventTypes` matches the event (or empty =
 * subscribed to all), POST the payload signed with the destination's
 * HMAC secret. Successes / failures are tracked on the destination row
 * so the admin UI can surface "this receiver has been failing".
 *
 * v1 fires-and-logs only — no automatic retry. A receiver that returns
 * 5xx gets `consecutiveFailures` incremented and the merchant sees the
 * error in the admin. Retry / queue / DLQ patterns are deferred.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { EventLog, WebhookDestination } from "@prisma/client";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

const REQUEST_TIMEOUT_MS = 5000;
const MAX_ERROR_LOG_LENGTH = 500;
const SIGNATURE_HEADER = "X-Ordak-Signature";
const EVENT_HEADER = "X-Ordak-Event";
const TIMESTAMP_HEADER = "X-Ordak-Timestamp";

export type DispatchableEvent = Pick<EventLog, "id" | "eventType" | "payload" | "timestamp">;

export type DispatchResult = {
  destinationId: string;
  ok: boolean;
  status?: number;
  error?: string;
};

/**
 * Compute the signature for a payload. Verifiers should use a constant-
 * time comparison against `sha256=<hex>`.
 */
export function signPayload(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Verify a signature with a constant-time comparison. Helpful in tests
 * and when the merchant builds a receiver — exported as part of the
 * dispatcher's contract.
 */
export function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = signPayload(secret, body);
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function destinationMatches(d: WebhookDestination, eventType: string): boolean {
  if (!d.enabled) return false;
  if (d.eventTypes.length === 0) return true;
  return d.eventTypes.includes(eventType);
}

async function postOne(
  destination: WebhookDestination,
  body: string,
  event: DispatchableEvent,
): Promise<DispatchResult> {
  const signature = signPayload(destination.secret, body);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(destination.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        [SIGNATURE_HEADER]: signature,
        [EVENT_HEADER]: event.eventType,
        [TIMESTAMP_HEADER]: event.timestamp.toISOString(),
      },
      body,
    });

    if (res.ok) {
      return { destinationId: destination.id, ok: true, status: res.status };
    }
    const errBody = (await res.text().catch(() => "")).slice(0, MAX_ERROR_LOG_LENGTH);
    return {
      destinationId: destination.id,
      ok: false,
      status: res.status,
      error: `HTTP ${res.status}: ${errBody}`,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timeout after ${REQUEST_TIMEOUT_MS}ms`
          : err.message
        : String(err);
    return {
      destinationId: destination.id,
      ok: false,
      error: message.slice(0, MAX_ERROR_LOG_LENGTH),
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function recordResult(shopId: string, result: DispatchResult): Promise<void> {
  // Scope by shopId — defensive symmetry with the dispatcher's load query.
  // updateMany accepts non-unique where; count===0 means the destination was
  // deleted between dispatch and record.
  if (result.ok) {
    await prisma.webhookDestination.updateMany({
      where: { id: result.destinationId, shopId },
      data: {
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        lastError: null,
      },
    });
    return;
  }
  await prisma.webhookDestination.updateMany({
    where: { id: result.destinationId, shopId },
    data: {
      lastFailureAt: new Date(),
      lastError: result.error ?? "Unknown error",
      consecutiveFailures: { increment: 1 },
    },
  });
}

/**
 * Dispatch an event to all matching destinations for a shop. Runs in
 * parallel with `Promise.allSettled`; failures are logged but never
 * thrown — the dispatcher must not break the EventLog write that
 * triggered it.
 */
export async function dispatchEvent(shopId: string, event: DispatchableEvent): Promise<DispatchResult[]> {
  let destinations: WebhookDestination[];
  try {
    destinations = await prisma.webhookDestination.findMany({
      where: { shopId, enabled: true },
    });
  } catch (err) {
    // Distinct from "no destinations configured" — the merchant has receivers
    // but a transient DB failure prevented dispatch. The EventLog row still
    // committed; receivers won't get this event. Log loudly with a stable
    // key so this can be alarmed on.
    logger.error("webhook_dispatch_lookup_failed: destinations query failed", err, {
      shopId,
      eventType: event.eventType,
    });
    return [];
  }

  const matched = destinations.filter((d) => destinationMatches(d, event.eventType));
  if (matched.length === 0) return [];

  // EventLog.payload is already a JSON string; wrap into the canonical
  // outer shape so receivers can rely on { id, eventType, timestamp,
  // payload } regardless of which event fired.
  const body = JSON.stringify({
    id: event.id,
    eventType: event.eventType,
    timestamp: event.timestamp.toISOString(),
    payload: safeParseJSON(event.payload),
  });

  const results = await Promise.all(
    matched.map(async (d) => {
      const result = await postOne(d, body, event);
      try {
        await recordResult(shopId, result);
      } catch (err) {
        // recordResult failure desyncs admin counters from reality. The
        // delivery itself already happened (or failed); we just couldn't
        // bump the counter. Log loudly so an operator can reconcile.
        logger.error("webhook_counter_desync: result write failed", err, {
          destinationId: d.id,
          eventType: event.eventType,
          deliveryOk: result.ok,
          deliveryError: result.error,
        });
      }
      if (!result.ok) {
        logger.warn("Webhook dispatch failed", {
          destinationId: d.id,
          url: d.url,
          eventType: event.eventType,
          error: result.error,
          status: result.status,
        });
      }
      return result;
    }),
  );

  return results;
}

function safeParseJSON(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
