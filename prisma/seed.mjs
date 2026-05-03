// Test-data seeder for ordak-go-dev.
//
// DEFAULT (safe, additive): creates the Location/Zone/Rule rows only if
// none exist for the shop, then upserts slots for the next 14 days. Safe
// to re-run; only adds missing slot rows.
//
// RESET=1 (destructive): wipes the shop's Location/Zone/Rule/Slot rows
// before re-creating them. Use only when you want to reset the shop's
// scheduling config. Requires explicit env flag to prevent accidents.
//
// Usage:
//   node prisma/seed.mjs                              # additive
//   RESET=1 node prisma/seed.mjs                      # destructive reset
//   SHOP=other.myshopify.com node prisma/seed.mjs     # different shop
//
// Touches NOTHING outside the configured shop. Skips if the shop row
// doesn't exist (run install + afterAuth first to bootstrap the Shop row).

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SHOP_DOMAIN = process.env.SHOP ?? "ordak-go-dev.myshopify.com";

const LOCATION = {
  name: "Sydney CBD",
  address: "1 Martin Place",
  city: "Sydney",
  province: "NSW",
  country: "AU",
  postalCode: "2000",
  latitude: -33.8688,
  longitude: 151.2093,
  phone: "+61400000000",
  email: "test@example.com",
  timezone: "Australia/Sydney",
};

const DELIVERY_POSTCODES = [
  "2000", "2007", "2008", "2009", "2010",
  "2011", "2015", "2016", "2017", "2018",
  "2037", "2038", "2039", "2040", "2041",
];

// Delivery: 4 windows per day, 2 hours each. Merchant can override via the
// admin Rules UI (Phase D will expose the schedule editor).
const DELIVERY_WINDOWS = [
  { start: "09:00", end: "11:00" },
  { start: "11:00", end: "13:00" },
  { start: "13:00", end: "15:00" },
  { start: "15:00", end: "17:00" },
];

// Pickup: ONE slot per date covering the whole pickup window. Per the
// product decision (no time slots for pickup), the customer just picks a
// date — the merchant communicates the time window via the cart-block
// "pickup banner text" theme editor setting. Capacity is the per-day cap.
const PICKUP_WINDOW = { start: "09:00", end: "17:00" };
const PICKUP_DAILY_CAPACITY = 20;

const SLOT_CAPACITY = 5;
const DAYS_AHEAD = 14;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function* nextDays(from, count) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const day = new Date(d);
    day.setDate(d.getDate() + i);
    // Skip Sundays (day 0) per "Monday – Saturday only" hint in the widget.
    if (day.getDay() !== 0) yield day;
  }
}

async function main() {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: SHOP_DOMAIN } });
  if (!shop) {
    console.error(
      `Shop ${SHOP_DOMAIN} not found. Install the app on the dev store first ` +
        `so afterAuth can bootstrap the Shop row, then re-run this seed.`,
    );
    process.exit(1);
  }
  console.log(`Seeding shop ${shop.shopifyDomain} (id=${shop.id})`);

  const reset = process.env.RESET === "1";
  if (reset) {
    const wipedSlots = await prisma.slot.deleteMany({
      where: { location: { shopId: shop.id } },
    });
    const wipedZones = await prisma.zone.deleteMany({ where: { shopId: shop.id } });
    const wipedRules = await prisma.rule.deleteMany({ where: { shopId: shop.id } });
    const wipedLocs = await prisma.location.deleteMany({ where: { shopId: shop.id } });
    console.log(
      `  RESET=1: cleared ${wipedLocs.count} location(s), ${wipedZones.count} zone(s), ` +
        `${wipedRules.count} rule(s), ${wipedSlots.count} slot(s)`,
    );
  }

  // Get-or-create location by name within shop (no unique constraint, so
  // findFirst + conditional create instead of upsert).
  let location = await prisma.location.findFirst({
    where: { shopId: shop.id, name: LOCATION.name },
  });
  if (!location) {
    location = await prisma.location.create({
      data: { ...LOCATION, shopId: shop.id, supportsDelivery: true, supportsPickup: true },
    });
    console.log(`  created location: ${location.name} (${location.id})`);
  } else {
    console.log(`  reusing location: ${location.name} (${location.id})`);
  }

  const existingZone = await prisma.zone.findFirst({
    where: { shopId: shop.id, locationId: location.id, name: "Inner West Sydney" },
  });
  if (!existingZone) {
    await prisma.zone.create({
      data: {
        shopId: shop.id,
        locationId: location.id,
        name: "Inner West Sydney",
        type: "postcode_list",
        postcodes: DELIVERY_POSTCODES,
        priority: 1,
      },
    });
    console.log(`  created zone: ${DELIVERY_POSTCODES.length} postcodes`);
  } else {
    console.log(`  reusing zone: ${existingZone.name}`);
  }

  for (const ruleSpec of [
    { name: "Default capacity", type: "capacity", slotDuration: 120, slotCapacity: SLOT_CAPACITY },
    { name: "Same-day cutoff", type: "cutoff", cutoffTime: "14:00" },
  ]) {
    const existing = await prisma.rule.findFirst({
      where: { shopId: shop.id, name: ruleSpec.name },
    });
    if (!existing) {
      await prisma.rule.create({ data: { ...ruleSpec, shopId: shop.id } });
      console.log(`  created rule: ${ruleSpec.name}`);
    } else {
      console.log(`  reusing rule: ${ruleSpec.name}`);
    }
  }

  const today = new Date();
  let created = 0;
  let skipped = 0;
  for (const day of nextDays(today, DAYS_AHEAD)) {
    // Delivery: per-window slots so the customer can pick a 2-hour band.
    for (const win of DELIVERY_WINDOWS) {
      const existing = await prisma.slot.findFirst({
        where: {
          locationId: location.id,
          date: day,
          timeStart: win.start,
          fulfillmentType: "delivery",
        },
      });
      if (existing) {
        skipped++;
      } else {
        await prisma.slot.create({
          data: {
            locationId: location.id,
            date: day,
            timeStart: win.start,
            timeEnd: win.end,
            capacity: SLOT_CAPACITY,
            booked: 0,
            fulfillmentType: "delivery",
            recommendationScore: 0.5,
          },
        });
        created++;
      }
    }
    // Pickup: a single full-day slot. Customer just picks a date; merchant
    // describes the actual hours via the cart-block "pickup banner text"
    // theme editor setting. Capacity is total pickups for the day.
    const existingPickup = await prisma.slot.findFirst({
      where: {
        locationId: location.id,
        date: day,
        fulfillmentType: "pickup",
      },
    });
    if (existingPickup) {
      skipped++;
    } else {
      await prisma.slot.create({
        data: {
          locationId: location.id,
          date: day,
          timeStart: PICKUP_WINDOW.start,
          timeEnd: PICKUP_WINDOW.end,
          capacity: PICKUP_DAILY_CAPACITY,
          booked: 0,
          fulfillmentType: "pickup",
          recommendationScore: 0.5,
        },
      });
      created++;
    }
  }
  console.log(`  slots: ${created} created, ${skipped} already existed`);

  console.log("\nDone. Try the widget on the storefront with a postcode like 2038 or 2000.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
