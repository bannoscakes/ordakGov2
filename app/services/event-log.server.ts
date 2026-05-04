import type { EventLog, Prisma, PrismaClient } from "@prisma/client";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { dispatchEvent } from "./webhook-dispatcher.server";

/**
 * Write an EventLog row AND dispatch to all matching enabled
 * WebhookDestinations for the shop.
 *
 * Use this for non-transactional call sites — the write and dispatch
 * happen sequentially with the top-level prisma client. Transactional
 * call sites should use {@link writeEventLogTx} inside the transaction
 * and call {@link dispatchEventLog} after commit.
 *
 * Dispatch failures are logged but never thrown — the EventLog row is
 * the source of truth and must succeed regardless of webhook receiver
 * health.
 */
export async function recordEvent(params: {
  shopId: string;
  data: Prisma.EventLogUncheckedCreateInput;
}): Promise<void> {
  const event = await prisma.eventLog.create({
    data: params.data,
    select: { id: true, eventType: true, payload: true, timestamp: true },
  });
  await dispatchEventLog(params.shopId, event);
}

/**
 * Write an EventLog row inside a transaction, returning the row so the
 * caller can dispatch AFTER the transaction commits. Dispatch must NOT
 * happen inside the transaction — webhook receivers can be slow and
 * holding DB locks for the duration of an HTTP round-trip is bad.
 */
export async function writeEventLogTx(params: {
  tx: PrismaClient | Prisma.TransactionClient;
  data: Prisma.EventLogUncheckedCreateInput;
}): Promise<DispatchableEventLog> {
  return params.tx.eventLog.create({
    data: params.data,
    select: { id: true, eventType: true, payload: true, timestamp: true },
  });
}

/**
 * Fire dispatch for an EventLog row that's already been committed.
 * Failures are logged but not rethrown.
 */
export async function dispatchEventLog(
  shopId: string,
  event: DispatchableEventLog,
): Promise<void> {
  try {
    await dispatchEvent(shopId, event);
  } catch (err) {
    logger.error("dispatchEventLog: webhook dispatch threw", err, {
      shopId,
      eventType: event.eventType,
    });
  }
}

export type DispatchableEventLog = Pick<EventLog, "id" | "eventType" | "payload" | "timestamp">;
