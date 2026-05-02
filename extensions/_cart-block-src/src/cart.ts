export type CartAttributes = Record<string, string>;

const DEBOUNCE_MS = 250;
const RESTORE_RETRY_LIMIT = 3;

interface PendingWrite {
  attrs: CartAttributes;
  resolve: () => void;
}

class CartWriter {
  private inflight: Promise<void> | null = null;
  private queued: PendingWrite | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastWritten: CartAttributes = {};
  private restoreCount = 0;

  async write(partial: CartAttributes): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queued = {
        attrs: { ...(this.queued?.attrs ?? {}), ...partial },
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
    this.inflight = this.send(pending.attrs)
      .finally(() => {
        this.inflight = null;
        pending.resolve();
        if (this.queued) void this.flush();
      });
    return this.inflight;
  }

  private async send(attrs: CartAttributes): Promise<void> {
    try {
      await fetch("/cart/update.js", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ attributes: attrs }),
      });
      this.lastWritten = { ...this.lastWritten, ...attrs };
      this.restoreCount = 0;
    } catch {
      /* swallow — UI shows its own error state */
    }
  }

  /** Re-apply attributes if a theme cart re-render dropped them. */
  async ensure(): Promise<void> {
    if (this.restoreCount >= RESTORE_RETRY_LIMIT) return;
    if (!Object.keys(this.lastWritten).length) return;
    try {
      const cart = await fetch("/cart.js", { credentials: "same-origin" }).then((r) => r.json());
      const live = (cart?.attributes ?? {}) as CartAttributes;
      const missing: CartAttributes = {};
      for (const k of Object.keys(this.lastWritten)) {
        if (live[k] !== this.lastWritten[k]) missing[k] = this.lastWritten[k];
      }
      if (Object.keys(missing).length) {
        this.restoreCount += 1;
        await this.send(missing);
      }
    } catch {
      /* ignore */
    }
  }
}

export const cartWriter = new CartWriter();

export function buildCartAttrs(args: {
  fulfillment: "delivery" | "pickup";
  slotId?: string | null;
  slotDate?: string | null;
  slotTimeStart?: string | null;
  slotTimeEnd?: string | null;
  locationId?: string | null;
  wasRecommended?: boolean;
  recommendationScore?: number;
}): CartAttributes {
  const out: CartAttributes = {
    delivery_method: args.fulfillment,
  };
  if (args.slotId) out.slot_id = args.slotId;
  if (args.slotDate) out.slot_date = args.slotDate;
  if (args.slotTimeStart) out.slot_time_start = args.slotTimeStart;
  if (args.slotTimeEnd) out.slot_time_end = args.slotTimeEnd;
  if (args.locationId) out.location_id = args.locationId;
  if (args.wasRecommended !== undefined) out.was_recommended = String(args.wasRecommended);
  if (args.recommendationScore !== undefined) out.recommendation_score = String(args.recommendationScore);
  return out;
}

export function listenForCartUpdates(handler: () => void) {
  // Most OS 2.0 themes emit one of these; we listen broadly.
  const events = ["cart:updated", "cart:refresh", "cart-updated"];
  events.forEach((evt) => document.addEventListener(evt, handler));
  return () => events.forEach((evt) => document.removeEventListener(evt, handler));
}
