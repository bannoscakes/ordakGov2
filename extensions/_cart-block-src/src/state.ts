import { signal, computed } from "@preact/signals";
import type { Signal } from "@preact/signals";
import type {
  Fulfillment,
  EligibilityLocation,
  RecommendedLocation,
  Slot,
} from "./types";

const FULFILLMENT_STORAGE_KEY = "ordak_fulfillment_type";

function readStoredFulfillment(): Fulfillment | null {
  try {
    const v = sessionStorage.getItem(FULFILLMENT_STORAGE_KEY);
    return v === "delivery" || v === "pickup" ? v : null;
  } catch {
    return null;
  }
}

function writeStoredFulfillment(value: Fulfillment) {
  try {
    sessionStorage.setItem(FULFILLMENT_STORAGE_KEY, value);
  } catch {
    /* private mode, etc. */
  }
}

export interface AppState {
  fulfillment: Signal<Fulfillment>;
  postcode: Signal<string>;
  postcodeChecked: Signal<boolean>;
  eligibilityLocations: Signal<EligibilityLocation[]>;
  servicesAvailable: Signal<{ delivery: boolean; pickup: boolean }>;
  eligibilityMessage: Signal<string | null>;

  selectedDate: Signal<string | null>;
  slots: Signal<Slot[]>;
  selectedSlot: Signal<Slot | null>;

  pickupLocations: Signal<RecommendedLocation[]>;
  selectedLocation: Signal<RecommendedLocation | null>;

  loading: Signal<{ slots: boolean; locations: boolean; eligibility: boolean }>;
  error: Signal<string | null>;
}

export function createState(defaultFulfillment: Fulfillment): AppState {
  const initialFulfillment = readStoredFulfillment() ?? defaultFulfillment;

  const state: AppState = {
    fulfillment: signal(initialFulfillment),
    postcode: signal(""),
    postcodeChecked: signal(false),
    eligibilityLocations: signal([] as EligibilityLocation[]),
    servicesAvailable: signal({ delivery: false, pickup: false }),
    eligibilityMessage: signal(null as string | null),
    selectedDate: signal(null as string | null),
    slots: signal([] as Slot[]),
    selectedSlot: signal(null as Slot | null),
    pickupLocations: signal([] as RecommendedLocation[]),
    selectedLocation: signal(null as RecommendedLocation | null),
    loading: signal({ slots: false, locations: false, eligibility: false }),
    error: signal(null as string | null),
  };

  return state;
}

export function persistFulfillment(value: Fulfillment) {
  writeStoredFulfillment(value);
}

export function emitFulfillmentChange(target: Element, type: Fulfillment) {
  target.dispatchEvent(
    new CustomEvent("ordak:fulfillment-change", {
      bubbles: true,
      detail: { type },
    })
  );
}

export const dateLabels = {
  todayLabel: "Today",
  tomorrowLabel: "Tomorrow",
};

export function describeDate(iso: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + "T00:00:00");
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return dateLabels.todayLabel;
  if (diffDays === 1) return dateLabels.tomorrowLabel;
  return target.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export const dateRangeFromToday = computed(() => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
});
