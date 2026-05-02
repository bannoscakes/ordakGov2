import { sessionId } from "./analytics";
import type {
  BlockConfig,
  EligibilityResponse,
  LocationResponse,
  SlotResponse,
  Fulfillment,
} from "./types";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Ordak-Session": sessionId(),
    },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.message ?? (await res.text());
    } catch {
      detail = res.statusText;
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

export class OrdakApi {
  constructor(private cfg: BlockConfig) {}

  private url(suffix: string) {
    return `${this.cfg.proxyBase}${suffix}`;
  }

  checkEligibility(postcode: string, fulfillmentType: Fulfillment): Promise<EligibilityResponse> {
    return post<EligibilityResponse>(this.url("/eligibility/check"), {
      postcode,
      fulfillmentType,
      shopDomain: this.cfg.shopDomain,
    });
  }

  fetchSlots(args: {
    fulfillmentType: Fulfillment;
    locationId?: string;
    postcode?: string;
    dateRange: { startDate: string; endDate: string };
  }): Promise<SlotResponse> {
    return post<SlotResponse>(this.url("/recommendations/slots"), {
      fulfillmentType: args.fulfillmentType,
      locationId: args.locationId,
      postcode: args.postcode,
      customerId: this.cfg.customerId ?? undefined,
      customerEmail: this.cfg.customerEmail ?? undefined,
      dateRange: args.dateRange,
    });
  }

  fetchLocations(postcode: string, fulfillmentType: Fulfillment): Promise<LocationResponse> {
    return post<LocationResponse>(this.url("/recommendations/locations"), {
      postcode,
      fulfillmentType,
      shopDomain: this.cfg.shopDomain,
      customerId: this.cfg.customerId ?? undefined,
      customerEmail: this.cfg.customerEmail ?? undefined,
    });
  }

  trackViewed(recs: { type: "slot" | "location"; id: string; recommendationScore: number }[]): void {
    if (!recs.length) return;
    void post(this.url("/events/recommendation-viewed"), {
      sessionId: sessionId(),
      customerId: this.cfg.customerId ?? undefined,
      customerEmail: this.cfg.customerEmail ?? undefined,
      shopifyDomain: this.cfg.shopDomain,
      recommendations: recs,
    }).catch(() => {});
  }

  trackSelected(args: {
    type: "slot" | "location";
    id: string;
    recommendationScore?: number;
    wasRecommended: boolean;
    alternativesShown?: string[];
  }): void {
    void post(this.url("/events/recommendation-selected"), {
      sessionId: sessionId(),
      customerId: this.cfg.customerId ?? undefined,
      customerEmail: this.cfg.customerEmail ?? undefined,
      shopifyDomain: this.cfg.shopDomain,
      selected: {
        type: args.type,
        id: args.id,
        recommendationScore: args.recommendationScore,
        wasRecommended: args.wasRecommended,
      },
      alternativesShown: args.alternativesShown,
    }).catch(() => {});
  }
}
