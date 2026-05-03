export type CartAttributes = Record<string, string>;

const DEBOUNCE_MS = 250;
const RESTORE_RETRY_LIMIT = 3;

export interface CartPayload {
  attrs: CartAttributes;
  // _-prefixed mirror of attrs. Stamped on every line so they appear at
  // rate.items[*].properties in the Carrier Service callback (which does
  // NOT receive cart note_attributes) and on order line_items[*].properties.
  lineProps: CartAttributes;
}

interface PendingWrite {
  payload: CartPayload;
  resolve: () => void;
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
  private inflight: Promise<void> | null = null;
  private queued: PendingWrite | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastAttrs: CartAttributes = {};
  private lastLineProps: CartAttributes = {};
  private restoreCount = 0;

  async write(partial: CartPayload): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queued = {
        payload: mergePayloads(this.queued?.payload, partial),
        resolve,
      };
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
    });
  }

  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.flush();
  }

  private async flush(): Promise<void> {
    if (!this.queued) return;
    if (this.inflight) {
      await this.inflight;
      return this.flush();
    }
    const pending = this.queued;
    this.queued = null;
    this.inflight = this.send(pending.payload)
      .finally(() => {
        this.inflight = null;
        pending.resolve();
        if (this.queued) void this.flush();
      });
    return this.inflight;
  }

  private async send(payload: CartPayload): Promise<void> {
    try {
      // 1. Cart attributes — for the merchant-visible cart and order note_attributes.
      await fetch("/cart/update.js", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ attributes: payload.attrs }),
      });
      this.lastAttrs = { ...this.lastAttrs, ...payload.attrs };

      // 2. Line item properties — for Carrier Service rate callback + order line items.
      if (Object.keys(payload.lineProps).length) {
        await this.applyLineProps(payload.lineProps);
        this.lastLineProps = { ...this.lastLineProps, ...payload.lineProps };
      }

      this.restoreCount = 0;
    } catch {
      /* swallow — UI shows its own error state */
    }
  }

  private async applyLineProps(lineProps: CartAttributes): Promise<void> {
    const cart = await fetch("/cart.js", { credentials: "same-origin" }).then(
      (r) => r.json() as Promise<CartResponse>,
    );
    const items = cart.items ?? [];
    for (const item of items) {
      const current = item.properties ?? {};
      const merged: Record<string, string> = { ...current, ...lineProps };
      if (propsEqual(current, merged)) continue;
      // /cart/change.js replaces the line's properties wholesale, so merging
      // with `current` above preserves any non-`_` properties (e.g. theme
      // personalization fields) the customer set when adding the product.
      await fetch("/cart/change.js", {
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
    }
  }

  /** Re-apply attributes + line props if a theme cart re-render dropped them. */
  async ensure(): Promise<void> {
    if (this.restoreCount >= RESTORE_RETRY_LIMIT) return;
    if (!Object.keys(this.lastAttrs).length && !Object.keys(this.lastLineProps).length) return;
    try {
      const cart = await fetch("/cart.js", { credentials: "same-origin" }).then(
        (r) => r.json() as Promise<CartResponse>,
      );
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
        this.restoreCount += 1;
        await this.send({
          attrs: missingAttrs,
          lineProps: propsMissing ? this.lastLineProps : {},
        });
      }
    } catch {
      /* ignore */
    }
  }
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
  wasRecommended?: boolean;
  recommendationScore?: number;
}): CartPayload {
  const attrs: CartAttributes = {
    delivery_method: args.fulfillment,
  };
  if (args.slotId) attrs.slot_id = args.slotId;
  if (args.slotDate) attrs.slot_date = args.slotDate;
  if (args.slotTimeStart) attrs.slot_time_start = args.slotTimeStart;
  if (args.slotTimeEnd) attrs.slot_time_end = args.slotTimeEnd;
  if (args.locationId) attrs.location_id = args.locationId;
  if (args.wasRecommended !== undefined) attrs.was_recommended = String(args.wasRecommended);
  if (args.recommendationScore !== undefined) {
    attrs.recommendation_score = String(args.recommendationScore);
  }

  const lineProps: CartAttributes = {};
  for (const [k, v] of Object.entries(attrs)) {
    lineProps[`_${k}`] = v;
  }

  return { attrs, lineProps };
}

export function listenForCartUpdates(handler: () => void) {
  // Most OS 2.0 themes emit one of these; we listen broadly.
  const events = ["cart:updated", "cart:refresh", "cart-updated"];
  events.forEach((evt) => document.addEventListener(evt, handler));
  return () => events.forEach((evt) => document.removeEventListener(evt, handler));
}
