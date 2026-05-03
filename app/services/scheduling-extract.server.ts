/**
 * Scheduling extraction
 *
 * Pulls scheduling info (slot id, fulfillment type, was-recommended flag,
 * recommendation score) out of a Shopify order. Two callers consume this:
 *
 *   - `webhooks.orders.create.tsx` — runs on every new order webhook,
 *     reads from the REST-shaped `OrderPayload` (snake_case
 *     `note_attributes`, `line_items[].properties`).
 *   - `app.backfill-orders.tsx` — runs on demand against the Admin
 *     GraphQL response (camelCase `customAttributes` per line and per
 *     order). Same semantics, different field names.
 *
 * Previously each route had its own near-identical copy of these helpers,
 * which drifted in subtle ways (e.g. PR #42 added `parseScore` NaN
 * defense to one but not the other). This module is the single source of
 * truth — both routes adapt their input shape into the `NameValuePair`
 * arrays this module reads.
 *
 * Source-of-truth precedence: line item properties first (they match
 * what the Carrier Service callback saw at checkout, so they're the
 * freshest snapshot of the customer's choice), then cart-level
 * note_attributes (fallback for orders that bypassed shipping, e.g.
 * legacy or backfill paths). New cart-block writes only land at the line
 * level — the note_attribute branch is kept for backfilled / legacy
 * orders, NOT for current new orders.
 */

export interface NameValuePair {
  name: string;
  value: string;
}

export interface ExtractedScheduling {
  slotId: string;
  fulfillmentType: "delivery" | "pickup";
  wasRecommended: boolean;
  // null when absent (cart-block doesn't write this — kept extracted
  // for legacy / backfilled orders that may have it via Admin UI edits).
  recommendationScore: number | null;
}

export function valueFor(
  pairs: NameValuePair[] | undefined,
  key: string,
): string | undefined {
  return pairs?.find((p) => p.name === key)?.value;
}

// Returns null on unknown values (was previously a silent coercion to
// "delivery"). Callers should treat null as "no scheduling info found"
// so a typo like `_delivery_method=takeaway` surfaces as an orphaned
// order in EventLog rather than booking a ghost delivery.
export function parseFulfillment(
  value: string | undefined,
): "delivery" | "pickup" | null {
  if (value === "pickup") return "pickup";
  if (value === "delivery") return "delivery";
  return null;
}

export function parseScore(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  // Number("foo") => NaN, Number("Infinity") => Infinity. Postgres
  // accepts NaN in DOUBLE PRECISION which then poisons sort/compare
  // queries; coerce both to null.
  return Number.isFinite(n) ? n : null;
}

export interface OrderShape {
  note_attributes?: NameValuePair[];
  line_items?: Array<{ properties?: NameValuePair[] }>;
}

export function extractScheduling(order: OrderShape): ExtractedScheduling | null {
  for (const line of order.line_items ?? []) {
    const slotId = valueFor(line.properties, "_slot_id");
    if (slotId) {
      const fulfillmentType = parseFulfillment(
        valueFor(line.properties, "_delivery_method"),
      );
      if (!fulfillmentType) return null;
      return {
        slotId,
        fulfillmentType,
        wasRecommended: valueFor(line.properties, "_was_recommended") === "true",
        recommendationScore: parseScore(
          valueFor(line.properties, "_recommendation_score"),
        ),
      };
    }
  }

  const slotId = valueFor(order.note_attributes, "slot_id");
  if (!slotId) return null;
  const fulfillmentType = parseFulfillment(
    valueFor(order.note_attributes, "delivery_method"),
  );
  if (!fulfillmentType) return null;
  return {
    slotId,
    fulfillmentType,
    wasRecommended: valueFor(order.note_attributes, "was_recommended") === "true",
    recommendationScore: parseScore(
      valueFor(order.note_attributes, "recommendation_score"),
    ),
  };
}
