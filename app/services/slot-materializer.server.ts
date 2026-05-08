import type { Prisma, PrismaClient, SlotTemplate } from "@prisma/client";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

/**
 * Slot materializer
 *
 * Converts SlotTemplate rows (per day-of-week config the merchant edits in
 * admin) into concrete Slot rows for the next N days that the cart-block
 * and Carrier Service callback can read.
 *
 * Idempotent: re-running for the same scope deletes empty future slots and
 * recreates from current templates. Slots with `booked > 0` are PRESERVED
 * untouched so existing customer bookings aren't lost — even if the
 * merchant changes the template that originally produced them. Stale
 * booked slots are the merchant's problem to reschedule manually.
 */

export const DEFAULT_HORIZON_DAYS = 14;

type Tx = PrismaClient | Prisma.TransactionClient;

export type MaterializeScope =
  | { kind: "zone"; zoneId: string; fulfillmentType: "delivery" | "pickup" }
  | { kind: "location"; locationId: string; fulfillmentType: "delivery" | "pickup" };

export type MaterializeResult = {
  ok: true;
  slotsCreated: number;
  slotsDeleted: number;
  slotsPreservedDueToBookings: number;
};

/**
 * Materialize a scope (one zone+fulfillment, or one location+fulfillment for
 * pickup) over the next `horizonDays` days starting from `today`.
 *
 * Pass an existing transaction client to compose with the admin save.
 * Otherwise a fresh transaction is used.
 */
export async function materializeSlots(
  scope: MaterializeScope,
  options: { horizonDays?: number; today?: Date; tx?: Tx } = {},
): Promise<MaterializeResult> {
  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const today = options.today ?? new Date();
  today.setHours(0, 0, 0, 0);

  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + horizonDays);

  const run = async (tx: Tx): Promise<MaterializeResult> => {
    // Load active templates for the scope
    const templates = await tx.slotTemplate.findMany({
      where: scopeToTemplateWhere(scope, true),
    });

    // Find existing future slots in this scope
    const existingSlots = await tx.slot.findMany({
      where: {
        ...scopeToSlotWhere(scope),
        date: { gte: today, lte: horizon },
      },
    });

    // Partition existing slots: empty (safe to delete) vs. booked (must preserve)
    const emptyFutureIds: string[] = [];
    let preservedCount = 0;
    for (const s of existingSlots) {
      if (s.booked > 0) {
        preservedCount++;
      } else {
        emptyFutureIds.push(s.id);
      }
    }

    // Delete empty future slots; we'll recreate from current templates below
    if (emptyFutureIds.length > 0) {
      await tx.slot.deleteMany({ where: { id: { in: emptyFutureIds } } });
    }

    // Build the dates × templates matrix
    const locationId = await resolveLocationId(tx, scope);
    const slotData: Prisma.SlotCreateManyInput[] = [];
    for (let i = 0; i < horizonDays; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dow = date.getDay();
      for (const t of templates) {
        if (t.dayOfWeek !== dow) continue;
        // Skip if a booked slot already covers this exact (date, time, fulfillment)
        // — we don't want to create a duplicate alongside a preserved booking.
        const collides = existingSlots.some(
          (s) =>
            s.booked > 0 &&
            s.date.getTime() === date.getTime() &&
            s.timeStart === t.timeStart &&
            s.timeEnd === t.timeEnd &&
            s.fulfillmentType === t.fulfillmentType,
        );
        if (collides) continue;
        slotData.push({
          locationId,
          zoneId: scope.kind === "zone" ? scope.zoneId : null,
          date,
          timeStart: t.timeStart,
          timeEnd: t.timeEnd,
          capacity: t.capacity,
          booked: 0,
          priceAdjustment: t.priceAdjustment,
          cutoffOffsetMinutes: t.cutoffOffsetMinutes,
          fulfillmentType: t.fulfillmentType,
          isActive: true,
        });
      }
    }

    let created = 0;
    if (slotData.length > 0) {
      const result = await tx.slot.createMany({ data: slotData });
      created = result.count;
    }

    return {
      ok: true,
      slotsCreated: created,
      slotsDeleted: emptyFutureIds.length,
      slotsPreservedDueToBookings: preservedCount,
    };
  };

  if (options.tx) return run(options.tx);

  try {
    return await prisma.$transaction(run);
  } catch (error) {
    logger.error("materializeSlots failed", error, {
      scope: JSON.stringify(scope),
    });
    throw error;
  }
}

function scopeToTemplateWhere(scope: MaterializeScope, activeOnly: boolean): Prisma.SlotTemplateWhereInput {
  const base: Prisma.SlotTemplateWhereInput = activeOnly ? { isActive: true } : {};
  if (scope.kind === "zone") {
    return { ...base, zoneId: scope.zoneId, fulfillmentType: scope.fulfillmentType };
  }
  return {
    ...base,
    locationId: scope.locationId,
    zoneId: null,
    fulfillmentType: scope.fulfillmentType,
  };
}

function scopeToSlotWhere(scope: MaterializeScope): Prisma.SlotWhereInput {
  if (scope.kind === "zone") {
    return { zoneId: scope.zoneId, fulfillmentType: scope.fulfillmentType };
  }
  return {
    locationId: scope.locationId,
    zoneId: null,
    fulfillmentType: scope.fulfillmentType,
  };
}

async function resolveLocationId(tx: Tx, scope: MaterializeScope): Promise<string> {
  if (scope.kind === "location") return scope.locationId;
  const zone = await tx.zone.findUnique({
    where: { id: scope.zoneId },
    select: { locationId: true },
  });
  if (!zone) {
    throw new Error(`Zone ${scope.zoneId} not found while materializing slots`);
  }
  return zone.locationId;
}

/**
 * Bulk-replace templates for a scope and re-materialize. Used by the admin
 * "Save time slots" action: takes the merchant's full list of rows for one
 * (scope, dayOfWeek), wipes the existing templates for that exact tuple,
 * inserts the new ones, then re-materializes the affected slots.
 */
export async function replaceTemplatesAndMaterialize(params: {
  scope: MaterializeScope;
  dayOfWeek: number;
  rows: Array<{
    timeStart: string;
    timeEnd: string;
    capacity: number;
    priceAdjustment: number;
    cutoffOffsetMinutes: number | null;
    isActive: boolean;
  }>;
  horizonDays?: number;
}): Promise<MaterializeResult> {
  const { scope, dayOfWeek, rows } = params;

  return prisma.$transaction(async (tx) => {
    const locationId = await resolveLocationId(tx, scope);

    await tx.slotTemplate.deleteMany({
      where: {
        ...scopeToTemplateWhere(scope, false),
        dayOfWeek,
      },
    });

    if (rows.length > 0) {
      await tx.slotTemplate.createMany({
        data: rows.map((r) => ({
          zoneId: scope.kind === "zone" ? scope.zoneId : null,
          locationId,
          fulfillmentType: scope.fulfillmentType,
          dayOfWeek,
          timeStart: r.timeStart,
          timeEnd: r.timeEnd,
          capacity: r.capacity,
          priceAdjustment: r.priceAdjustment,
          cutoffOffsetMinutes: r.cutoffOffsetMinutes,
          isActive: r.isActive,
        })),
      });
    }

    return materializeSlots(scope, { horizonDays: params.horizonDays, tx });
  });
}

/**
 * Copy templates from one (scope, dayOfWeek) to another (or many).
 * Used by the "Copy Monday to..." admin shortcut.
 */
export async function copyTemplatesBetweenDays(params: {
  scope: MaterializeScope;
  fromDayOfWeek: number;
  toDaysOfWeek: number[];
  horizonDays?: number;
}): Promise<MaterializeResult[]> {
  const { scope, fromDayOfWeek, toDaysOfWeek } = params;

  return prisma.$transaction(async (tx) => {
    const sourceTemplates = await tx.slotTemplate.findMany({
      where: { ...scopeToTemplateWhere(scope, false), dayOfWeek: fromDayOfWeek },
    });

    const results: MaterializeResult[] = [];
    for (const targetDow of toDaysOfWeek) {
      if (targetDow === fromDayOfWeek) continue;

      await tx.slotTemplate.deleteMany({
        where: { ...scopeToTemplateWhere(scope, false), dayOfWeek: targetDow },
      });

      if (sourceTemplates.length > 0) {
        const locationId = await resolveLocationId(tx, scope);
        await tx.slotTemplate.createMany({
          data: sourceTemplates.map((s) => ({
            zoneId: scope.kind === "zone" ? scope.zoneId : null,
            locationId,
            fulfillmentType: scope.fulfillmentType,
            dayOfWeek: targetDow,
            timeStart: s.timeStart,
            timeEnd: s.timeEnd,
            capacity: s.capacity,
            priceAdjustment: s.priceAdjustment,
            cutoffOffsetMinutes: s.cutoffOffsetMinutes,
            isActive: s.isActive,
          })),
        });
      }

      const r = await materializeSlots(scope, { horizonDays: params.horizonDays, tx });
      results.push(r);
    }
    return results;
  });
}

/**
 * Get templates grouped by dayOfWeek for an admin form. Returns a 7-element
 * array (index 0 = Sunday, ..., 6 = Saturday) of arrays of templates. Empty
 * arrays for days with no templates configured.
 */
export async function getTemplatesByDay(scope: MaterializeScope): Promise<SlotTemplate[][]> {
  const templates = await prisma.slotTemplate.findMany({
    where: scopeToTemplateWhere(scope, false),
    orderBy: [{ dayOfWeek: "asc" }, { timeStart: "asc" }],
  });
  const byDay: SlotTemplate[][] = [[], [], [], [], [], [], []];
  for (const t of templates) {
    if (t.dayOfWeek >= 0 && t.dayOfWeek <= 6) byDay[t.dayOfWeek].push(t);
  }
  return byDay;
}
