export type CartAttributes = Record<string, string>;

const DEBOUNCE_MS = 250;
const RESTORE_RETRY_LIMIT = 3;

export interface CartPayload {
  attrs: CartAttributes;
  // _-prefixed mirror of attrs. Stamped on every line so they appear at
  // rate.items[*].properties in the Carrier Service callback (which does
  // NOT receive cart note_attributes) and on order line_items[*].properties.
  // Invariant: every key MUST start with `_`. Enforced at write time in
  // applyLineProps so a stray non-prefixed key gets dropped + logged
  // rather than silently breaking the C.5 Function's `line.attribute`
  // lookup (which only matches `_delivery_method`, etc.).
  lineProps: CartAttributes;
}

// Discriminated union returned to callers so they can distinguish "we
// successfully synced everything Shopify needs" from "the cart-level
// attrs reached Shopify but line props failed" from "nothing landed."
// The previous void return swallowed all three cases — UI showed the
// slot as selected even when /cart/update.js never returned 200, leading
// to checkouts with no _delivery_method and unfiltered rates.
export type WriteResult =
  | { ok: true; lineProps: "ok" | "skipped" | "failed" }
  | { ok: false; reason: "attrsFailed"; detail: string };

interface PendingWrite {
  payload: CartPayload;
  resolvers: Array<(result: WriteResult) => void>;
}

interface CartItem {
  key: string;
  quantity: number;
  properties: Record<string, string> | null;
}

interface CartResponse {
  attributes?: CartAttributes;
  items?: CartItem[];
}

function mergePayloads(a: CartPayload | undefined, b: CartPayload): CartPayload {
  return {
    attrs: { ...(a?.attrs ?? {}), ...b.attrs },
    lineProps: { ...(a?.lineProps ?? {}), ...b.lineProps },
  };
}

class CartWriter {
  private inflight: Promise<WriteResult> | null = null;
  private queued: PendingWrite | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastAttrs: CartAttributes = {};
  private lastLineProps: CartAttributes = {};
  private restoreCount = 0;

  // Returns a Promise that resolves with the per-call WriteResult AFTER
  // the debounced batch this call joined finishes. Multiple writes that
  // get coalesced into one network call all resolve with the same
  // WriteResult — that's intentional: the merged payload either landed
  // or didn't.
  async write(partial: CartPayload): Promise<WriteResult> {
    return new Promise<WriteResult>((resolve) => {
      const merged = mergePayloads(this.queued?.payload, partial);
      const resolvers = this.queued?.resolvers ?? [];
      resolvers.push(resolve);
      this.queued = { payload: merged, resolvers };
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
    });
  }

  async flushNow(): Promise<WriteResult | null> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.queued) return null;
    return this.flush();
  }

  private async flush(): Promise<WriteResult> {
    if (!this.queued) {
      // Race: timer fired but write() already resolved everything via a
      // prior flush. Return a benign success so callers don't get a
      // never-settling promise.
      return { ok: true, lineProps: "skipped" };
    }
    if (this.inflight) {
      await this.inflight;
      return this.flush();
    }
    const pending = this.queued;
    this.queued = null;
    this.inflight = this.send(pending.payload, { resetRestoreBudget: true });
    try {
      const result = await this.inflight;
      for (const r of pending.resolvers) r(result);
      return result;
    } finally {
      this.inflight = null;
      if (this.queued) void this.flush();
    }
  }

  private async send(
    payload: CartPayload,
    opts: { resetRestoreBudget: boolean } = { resetRestoreBudget: false },
  ): Promise<WriteResult> {
    // 1. Cart attributes — visible in the merchant-facing cart and propagate
    //    to order note_attributes. We only mark them as "written" after a
    //    confirmed 200; otherwise ensure() would compare against in-memory
    //    state that never reached Shopify.
    try {
      const res = await fetch("/cart/update.js", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ attributes: payload.attrs }),
      });
      if (!res.ok) {
        const body = await safeReadBody(res);
        // eslint-disable-next-line no-console
        console.warn(
          `[ordak] /cart/update.js failed: ${res.status} ${res.statusText}`,
          body,
        );
        // Don't update lastAttrs and don't reset restoreCount — let ensure()
        // try again on the next theme cart event.
        return { ok: false, reason: "attrsFailed", detail: `${res.status} ${res.statusText}` };
      }
      this.lastAttrs = { ...this.lastAttrs, ...payload.attrs };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[ordak] /cart/update.js threw", err);
      return {
        ok: false,
        reason: "attrsFailed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    // 2. Line item properties — only required for the Carrier Service rate
    //    callback contract on stores that have CCS. Non-fatal on stores
    //    without CCS or where the theme strips them; the C.5 Function
    //    falls back to the cart-level `delivery_method` attribute we just
    //    confirmed above.
    let lineStatus: "ok" | "skipped" | "failed" = "skipped";
    const safeLineProps = filterPrefixed(payload.lineProps);
    if (Object.keys(safeLineProps).length) {
      try {
        await this.applyLineProps(safeLineProps);
        this.lastLineProps = { ...this.lastLineProps, ...safeLineProps };
        lineStatus = "ok";
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[ordak] applyLineProps failed", err);
        lineStatus = "failed";
        // Continue — cart attributes succeeded, which is enough for C.5.
      }
    }

    // Reset only on user-initiated writes (write()/flush()). If we reset
    // here for ensure()-driven calls too, we'd never escape an infinite
    // theme-strip loop: theme strips attrs → ensure() rewrites → reset →
    // theme strips again → ensure() rewrites → … Each user action gives
    // us a fresh RESTORE_RETRY_LIMIT budget; auto-restores burn through it.
    if (opts.resetRestoreBudget) {
      this.restoreCount = 0;
    }

    return { ok: true, lineProps: lineStatus };
  }

  // Re-fetches /cart.js, then PATCHes each line via /cart/change.js with
  // our `_`-prefixed properties merged onto whatever the line already had.
  // Throws on any non-2xx response so the caller can decide whether to
  // log+continue or recover. Skips lines that returned 422 mid-loop (line
  // removed concurrently in another tab) so a single removal doesn't
  // strand the rest of the cart.
  //
  // Race notes:
  //   /cart/change.js requires `quantity` — if you omit it, the line is
  //   removed. That creates a tiny window where another tab's quantity
  //   change between our /cart.js read and this write would be reset.
  //   Mitigation: re-fetch /cart.js once just before iterating (the items
  //   list below is the freshest snapshot), then read each line's quantity
  //   from THAT snapshot. The window is bounded to roundtrip latency for
  //   the change.js call. We don't refetch per-line because the marginal
  //   reduction isn't worth N extra network round-trips for a multi-line
  //   cart.
  private async applyLineProps(lineProps: CartAttributes): Promise<void> {
    const cartRes = await fetch("/cart.js", { credentials: "same-origin" });
    if (!cartRes.ok) {
      throw new Error(`/cart.js failed: ${cartRes.status} ${cartRes.statusText}`);
    }
    const cart = (await cartRes.json()) as CartResponse;
    const items = cart.items ?? [];
    for (const item of items) {
      const current = item.properties ?? {};
      const merged: Record<string, string> = { ...current, ...lineProps };
      if (propsEqual(current, merged)) continue;
      // /cart/change.js replaces the line's properties wholesale, so merging
      // with `current` above preserves any non-`_` properties (e.g. theme
      // personalization fields) the customer set when adding the product.
      const changeRes = await fetch("/cart/change.js", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          id: item.key,
          quantity: item.quantity,
          properties: merged,
        }),
      });
      if (changeRes.ok) {
        // Detect the race: Shopify returns the updated cart, which echoes
        // the line's actual quantity. If it differs from what we sent, the
        // customer changed quantity in another tab between our read and
        // write — log so it shows up in console while debugging, but
        // don't try to "fix" it (that just spirals).
        try {
          const body = (await changeRes.json()) as CartResponse;
          const updated = body.items?.find((i) => i.key === item.key);
          if (updated && updated.quantity !== item.quantity) {
            // eslint-disable-next-line no-console
            console.warn(
              `[ordak] line ${item.key} quantity drift: sent ${item.quantity}, server settled at ${updated.quantity}`,
            );
          }
        } catch {
          // Ignore body-read failures — the change itself succeeded.
        }
        continue;
      }
      // 422 typically means "line was removed by another tab between our
      // /cart.js read and this write." Log and move on rather than
      // aborting the whole loop — other lines are independent.
      if (changeRes.status === 422) {
        const body = await safeReadBody(changeRes);
        // eslint-disable-next-line no-console
        console.warn(
          `[ordak] /cart/change.js 422 for line ${item.key}; line may have been removed`,
          body,
        );
        continue;
      }
      const body = await safeReadBody(changeRes);
      throw new Error(
        `/cart/change.js failed for line ${item.key}: ${changeRes.status} ${changeRes.statusText} ${body}`,
      );
    }
  }

  /** Re-apply attributes + line props if a theme cart re-render dropped them. */
  async ensure(): Promise<void> {
    if (this.restoreCount >= RESTORE_RETRY_LIMIT) return;
    if (!Object.keys(this.lastAttrs).length && !Object.keys(this.lastLineProps).length) return;
    try {
      const cartRes = await fetch("/cart.js", { credentials: "same-origin" });
      if (!cartRes.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ordak] ensure: /cart.js failed: ${cartRes.status} ${cartRes.statusText}`,
        );
        return;
      }
      const cart = (await cartRes.json()) as CartResponse;
      const liveAttrs = cart.attributes ?? {};
      const missingAttrs: CartAttributes = {};
      for (const k of Object.keys(this.lastAttrs)) {
        if (liveAttrs[k] !== this.lastAttrs[k]) missingAttrs[k] = this.lastAttrs[k];
      }

      const items = cart.items ?? [];
      const propsMissing = items.some((item) => {
        const current = item.properties ?? {};
        return Object.keys(this.lastLineProps).some(
          (k) => current[k] !== this.lastLineProps[k],
        );
      });

      if (Object.keys(missingAttrs).length || propsMissing) {
        // Only burn budget if the send actually attempted writes. If
        // attrs failed we still count the attempt — otherwise a stuck
        // theme could trigger ensure() unbounded times via cart events
        // without us ever capping the spend. Three hits and we back off
        // until the next user-initiated write resets the budget.
        this.restoreCount += 1;
        await this.send({
          attrs: missingAttrs,
          lineProps: propsMissing ? this.lastLineProps : {},
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[ordak] ensure threw", err);
    }
  }
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

// Drop any lineProps key that doesn't start with `_` and log it. The
// Carrier Service callback and webhooks.orders.create only read
// `_`-prefixed properties; a non-prefixed key in this map can't be a
// useful signal and risks colluding with theme personalization fields
// that themes also store unprefixed.
function filterPrefixed(props: CartAttributes): CartAttributes {
  const out: CartAttributes = {};
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("_")) {
      out[k] = v;
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[ordak] dropping non-_-prefixed lineProps key: ${k}`);
    }
  }
  return out;
}

function propsEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

export const cartWriter = new CartWriter();

export function buildCartPayload(args: {
  fulfillment: "delivery" | "pickup";
  slotId?: string | null;
  slotDate?: string | null;
  slotTimeStart?: string | null;
  slotTimeEnd?: string | null;
  locationId?: string | null;
  zoneId?: string | null;
  wasRecommended?: boolean;
}): CartPayload {
  // Cart attributes propagate to the order's note_attributes and Shopify
  // surfaces them under the order's "Additional details" panel — visible
  // to the merchant. Keep this set merchant-friendly: only the four
  // pieces of info the merchant actually needs to see at a glance.
  // Internal IDs (slot_id, location_id) and analytics signals
  // (was_recommended, recommendation_score) live in the
  // ordak_scheduling metafields panel, not here.
  const attrs: CartAttributes = {
    delivery_method: args.fulfillment,
  };
  if (args.slotDate) attrs.slot_date = args.slotDate;
  if (args.slotTimeStart) attrs.slot_time_start = args.slotTimeStart;
  if (args.slotTimeEnd) attrs.slot_time_end = args.slotTimeEnd;

  // Line item properties show in the Shopify admin order under "Additional
  // details" (one row per line × per property). Stamping all 8 cart attrs
  // makes that section noisy for the merchant. We only mirror the
  // essentials onto lines:
  //   - _delivery_method: read by the C.5 delivery-customization Function
  //     to filter checkout rates (and as fallback for the cart-level attr)
  //   - _slot_id: read by webhooks/orders/create to look up the Slot row
  //   - _location_id: read by api.carrier-service.rates.tsx to scope the
  //     pickup-rate response to the customer's chosen location. Required
  //     for multi-location merchants (Bannos has Annandale + a second
  //     site); without this, the callback collapses to "first active
  //     pickup location" and silently mis-attributes the rate.
  //   - _was_recommended: provenance flag the webhook records on OrderLink
  // The rest (date, time, score) are derivable from the slot row once we
  // have _slot_id, so they don't need to be on every line item.
  const lineProps: CartAttributes = {
    _delivery_method: args.fulfillment,
  };
  if (args.slotId) lineProps._slot_id = args.slotId;
  if (args.locationId) lineProps._location_id = args.locationId;
  // Optional: when the cart-block has resolved a zoneId, the Carrier
  // Service callback can skip its own postcode re-match (it still verifies
  // the postcode falls in the supplied zone — line item properties are
  // customer-writable).
  if (args.zoneId) lineProps._zone_id = args.zoneId;
  if (args.wasRecommended !== undefined) {
    lineProps._was_recommended = String(args.wasRecommended);
  }

  return { attrs, lineProps };
}

export function listenForCartUpdates(handler: () => void) {
  // Most OS 2.0 themes emit one of these; we listen broadly.
  const events = ["cart:updated", "cart:refresh", "cart-updated"];
  events.forEach((evt) => document.addEventListener(evt, handler));
  return () => events.forEach((evt) => document.removeEventListener(evt, handler));
}
