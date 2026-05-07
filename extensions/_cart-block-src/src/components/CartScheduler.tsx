import { useEffect, useMemo, useRef } from "preact/hooks";
import { effect } from "@preact/signals";
import type {
  BlockConfig,
  RecommendedLocation,
  Slot,
} from "../types";
import {
  createState,
  dateRangeFromToday,
  emitFulfillmentChange,
  persistFulfillment,
} from "../state";
import { OrdakApi } from "../api";
import { buildCartPayload, cartWriter, listenForCartUpdates } from "../cart";
import { Toggle } from "./Toggle";
import { PostcodeField } from "./PostcodeField";
import { DatePicker } from "./DatePicker";
import { SlotGrid } from "./SlotGrid";
import { LocationList } from "./LocationList";
import { AlternativeSlots } from "./AlternativeSlots";

interface Props {
  config: BlockConfig;
  rootEl: Element;
}

// Wide selector union — clicks on inner buttons bubble to a matching
// ancestor, so we attach in capture phase. Express checkout buttons (Shop
// Pay / Apple Pay / Google Pay) are iframed and not catchable here — the
// Cart Validation Function is the only gate for those.
const CHECKOUT_BUTTON_SELECTOR =
  '[name="checkout"], button[name="checkout"], a[href="/checkout"], a[href*="/checkout?"], [data-checkout], .cart__checkout, .cart__checkout-button, .cart-checkout-button';

// Returns null when the cart has all required scheduling selections, or a
// human-readable reason when something is missing.
//
// Mirrors extensions/cart-validation/src/cart_validations_generate_run.ts —
// keep the two in sync. This helper is the single source of truth for
// client-side checkout gating; future changes to the rule set must update
// it together with the Function.
function describeMissingSelections(state: import("../state").AppState): string | null {
  const fulfillment = state.fulfillment.value;
  if (!fulfillment) return "Please choose Delivery or Pickup before checkout.";
  if (fulfillment === "delivery") {
    if (!state.postcodeChecked.value) {
      return "Please enter a delivery postcode before checkout.";
    }
    if (state.servicesAvailable.value.delivery !== true) {
      return "Delivery isn't available for the entered postcode.";
    }
  } else {
    // Pickup flow: eligibility API isn't called (no postcode), so
    // servicesAvailable.pickup stays at its initial false. The real signal
    // is whether pickup locations loaded — empty + not loading means the
    // shop has no active pickup locations and the merchant needs to add one.
    const noLocationsLoaded =
      state.pickupLocations.value.length === 0 && !state.loading.value.locations;
    if (noLocationsLoaded) {
      return "Pickup isn't available right now.";
    }
    if (!state.selectedLocation.value) {
      return "Please choose a pickup location before checkout.";
    }
  }
  if (!state.selectedSlot.value) {
    return fulfillment === "pickup"
      ? "Please choose a pickup date before checkout."
      : "Please choose a delivery date and time slot before checkout.";
  }
  return null;
}

function composeEligibilityMessage(
  apiMessage: string | null,
  matchedZone: { basePrice: string } | null,
  fulfillment: "delivery" | "pickup",
): string | null {
  if (fulfillment !== "delivery" || !matchedZone) return apiMessage;
  const fee = Number(matchedZone.basePrice);
  // Mirror the server-side toCents rule: NaN / non-finite / negative are
  // data corruption. The carrier-service throws InvalidPriceError for
  // these, so don't quietly render a misleading fee in the cart either.
  if (!Number.isFinite(fee) || fee < 0) {
    console.warn(`[ordak] invalid matchedZone.basePrice: ${matchedZone.basePrice}`);
    return apiMessage;
  }
  const feeLabel = fee > 0 ? `Delivery fee: $${fee.toFixed(2)}` : "Delivery fee: free";
  return apiMessage ? `${apiMessage} · ${feeLabel}` : feeLabel;
}

export function CartScheduler({ config, rootEl }: Props) {
  const state = useMemo(() => createState(config.defaultFulfillment), [config.defaultFulfillment]);
  const api = useMemo(() => new OrdakApi(config), [config]);
  const viewedTrackedRef = useRef(false);

  // Persist fulfillment + emit DOM event whenever it changes.
  useEffect(() => {
    return effect(() => {
      const v = state.fulfillment.value;
      persistFulfillment(v);
      emitFulfillmentChange(rootEl, v);
    });
  }, [state, rootEl]);

  // When fulfillment changes, reset downstream state so we re-fetch.
  useEffect(() => {
    return effect(() => {
      state.fulfillment.value; // dependency
      viewedTrackedRef.current = false;
      state.slots.value = [];
      state.selectedSlot.value = null;
      state.selectedLocation.value = null;
      state.pickupLocations.value = [];
    });
  }, [state]);

  // Auto-load pickup locations when fulfillment switches to pickup.
  // Pickup doesn't need a postcode (the customer comes to the location), so
  // we kick off the location load immediately rather than waiting for the
  // postcode field that we hide for pickup mode.
  //
  // Date is NOT auto-set here — customer must explicitly open the calendar
  // and pick a date. The pickup auto-slot effect (later in this file) only
  // fires once the date is set, so the chain is: customer picks date → slot
  // auto-fills (pickup has no time-grid UI) → Check out enables.
  useEffect(() => {
    return effect(() => {
      const isPickup = state.fulfillment.value === "pickup";
      const alreadyLoaded = state.pickupLocations.value.length > 0;
      const isLoading = state.loading.value.locations;
      if (isPickup && !alreadyLoaded && !isLoading) {
        void loadLocations();
      }
    });
  }, [state]);

  // Pickup mode hides the time-slot grid (per merchant — pickup is just a
  // date, the time window is communicated by the merchant-configured banner
  // text). The backend still needs a slot_id stamped on the cart, so when
  // slots load OR the date changes for pickup, auto-pick the first slot
  // that has capacity for the chosen date.
  useEffect(() => {
    return effect(() => {
      if (state.fulfillment.value !== "pickup") return;
      const date = state.selectedDate.value;
      if (!date) return;
      const slots = state.slots.value;
      if (!slots.length) return;
      const current = state.selectedSlot.value;
      if (current && current.date === date && current.capacityRemaining > 0) return;
      const candidate =
        slots.find((s) => s.date === date && s.capacityRemaining > 0) ?? null;
      if (candidate && candidate.slotId !== current?.slotId) {
        state.selectedSlot.value = candidate;
      }
    });
  }, [state]);

  // Re-apply cart attributes if the theme drops them after a re-render.
  useEffect(() => listenForCartUpdates(() => void cartWriter.ensure()), []);

  // Reflect missing-selection state visually on the theme's Check out
  // button. The click interceptor below is the load-bearing gate (it
  // preventDefault()s the click), but rendering the button as disabled
  // gives the customer an immediate cue that something's missing — they
  // shouldn't have to click before the cart-block reveals the rule.
  // Re-runs on every cart re-render via listenForCartUpdates because the
  // theme replaces the cart drawer's HTML on AJAX cart updates.
  useEffect(() => {
    const ORDAK_DISABLED_FLAG = "data-ordak-disabled";

    function applyDisabledState() {
      const missing = describeMissingSelections(state);
      const buttons = document.querySelectorAll(CHECKOUT_BUTTON_SELECTOR);
      buttons.forEach((btn) => {
        if (!(btn instanceof HTMLElement)) return;
        // Only touch buttons inside or adjacent to a cart drawer / cart page —
        // never the express-checkout iframes (they're cross-origin and
        // unreachable anyway). The selector union is broad enough that we
        // could match a button outside any cart context; bail if the button
        // has no cart-related ancestor.
        const inCartContext = !!btn.closest(
          'cart-drawer, cart-drawer-component, [data-cart-drawer], #cart-drawer, .cart-drawer, .drawer--cart, form[action*="/cart"], main#MainContent, .cart',
        );
        if (!inCartContext) return;
        if (missing) {
          if (!btn.hasAttribute(ORDAK_DISABLED_FLAG)) {
            btn.setAttribute(ORDAK_DISABLED_FLAG, "1");
            btn.setAttribute("aria-disabled", "true");
          }
        } else if (btn.hasAttribute(ORDAK_DISABLED_FLAG)) {
          btn.removeAttribute(ORDAK_DISABLED_FLAG);
          btn.removeAttribute("aria-disabled");
        }
      });
    }

    // Apply on every state change (date/slot/postcode picked or cleared).
    const stop = effect(() => {
      // Read every signal that describeMissingSelections depends on so the
      // effect re-runs when any of them changes.
      void state.fulfillment.value;
      void state.postcodeChecked.value;
      void state.servicesAvailable.value;
      void state.selectedLocation.value;
      void state.selectedSlot.value;
      void state.pickupLocations.value.length;
      void state.loading.value.locations;
      applyDisabledState();
    });

    // Re-apply after theme cart re-renders (the buttons get replaced).
    const stopCartListener = listenForCartUpdates(applyDisabledState);

    return () => {
      stop();
      stopCartListener();
    };
  }, [state]);

  // Intercept clicks on theme checkout buttons. The Cart Validation Function
  // is the authoritative backstop (it blocks express buttons too) but
  // intercepting here gives the customer immediate inline feedback and
  // avoids the "click checkout, get redirected, see error" round-trip for
  // the regular cart → checkout path. Fails closed: if the handler itself
  // throws, the click is still blocked and a generic error surfaces, so
  // a future bug here doesn't accidentally let a misconfigured cart slip
  // past both layers.
  useEffect(() => {
    function handler(event: Event) {
      try {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const checkoutEl = target.closest(CHECKOUT_BUTTON_SELECTOR);
        if (!checkoutEl) return;
        const missing = describeMissingSelections(state);
        if (!missing) return;
        event.preventDefault();
        event.stopPropagation();
        state.error.value = missing;
        rootEl.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (err) {
        console.error("[ordak] checkout interceptor failed", err);
        event.preventDefault();
        event.stopPropagation();
        state.error.value = "Couldn't verify your cart. Please refresh the page.";
      }
    }
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [state, rootEl]);

  // Whenever the selected slot changes, write attributes.
  useEffect(() => {
    return effect(() => {
      const slot = state.selectedSlot.value;
      const fulfillment = state.fulfillment.value;
      const loc = state.selectedLocation.value;

      // Surface attrsFailed back to the user via the existing error
      // signal — the previous void-and-forget hid /cart/update.js
      // failures so the UI showed the slot as selected even when
      // checkout would have no _delivery_method to filter on. lineProps
      // failures are non-fatal (the C.5 Function falls back to the
      // cart-level attr we did write), so we don't surface those.
      void cartWriter
        .write(
          buildCartPayload({
            fulfillment,
            slotId: slot?.slotId ?? null,
            slotDate: slot?.date ?? null,
            slotTimeStart: slot?.timeStart ?? null,
            slotTimeEnd: slot?.timeEnd ?? null,
            locationId: loc?.locationId ?? slot?.locationId ?? null,
            // Critical: without _zone_id on every cart line, the Carrier
            // Service callback's fast-path zone lookup is skipped and it
            // falls back to a postcode scan that may match a DIFFERENT
            // zone than the eligibility check resolved — different
            // basePrice + slot rejected → wrong checkout total.
            zoneId: slot?.zoneId ?? null,
            wasRecommended: slot?.recommended ?? false,
          })
        )
        .then((result) => {
          if (!result.ok) {
            state.error.value = `Couldn't save your selection (${result.detail}). Please try again or refresh the page.`;
          } else if (state.error.value?.startsWith("Couldn't save your selection")) {
            // Clear our own prior error if a subsequent write succeeds.
            state.error.value = null;
          }
        });
    });
  }, [state]);

  async function handleCheckPostcode(postcode: string) {
    state.postcode.value = postcode;
    state.loading.value = { ...state.loading.value, eligibility: true };
    state.error.value = null;
    try {
      const res = await api.checkEligibility(postcode, state.fulfillment.value);
      state.eligibilityLocations.value = res.locations;
      state.servicesAvailable.value = res.services;
      // Customer-facing copy lives in the cart-block, not in the API. When
      // a delivery zone is matched, append the merchant's basePrice so the
      // customer sees what they'll be charged before picking a slot.
      state.eligibilityMessage.value = composeEligibilityMessage(
        res.message ?? null,
        res.matchedZone ?? null,
        state.fulfillment.value,
      );
      state.postcodeChecked.value = true;

      if (res.eligible) {
        // Date is NOT auto-set here — customer must explicitly open the
        // date picker and choose. Slot loading is independent of the picker
        // (we fetch slots for the whole 14-day range up front) so the
        // grid populates as soon as the customer picks a date.
        if (state.fulfillment.value === "pickup") {
          await loadLocations(postcode);
        } else {
          await loadSlots();
        }
      }
    } catch (err) {
      state.error.value = (err as Error).message ?? "Eligibility check failed";
    } finally {
      state.loading.value = { ...state.loading.value, eligibility: false };
    }
  }

  async function loadSlots(locationId?: string) {
    state.loading.value = { ...state.loading.value, slots: true };
    state.error.value = null;
    try {
      const range = dateRangeFromToday.value;
      const res = await api.fetchSlots({
        fulfillmentType: state.fulfillment.value,
        locationId,
        postcode: state.postcode.value || undefined,
        dateRange: { startDate: range.start, endDate: range.end },
      });
      const slots = res.slots.slice().sort((a, b) => b.recommendationScore - a.recommendationScore);
      state.slots.value = slots;
      if (res.meta?.widgetAppearance) {
        state.widgetAppearance.value = res.meta.widgetAppearance;
      }
      // Date and slot selection are explicit customer actions — never
      // auto-set them server-side or based on slot data. Auto-selection
      // here was the bypass mechanism that let customers reach checkout
      // without consciously scheduling: cart attributes were populated by
      // the auto-pick, the click interceptor's missing-selection check
      // returned null, and Check out went through. The "recommended" badge
      // on a slot tile (rendered by SlotGrid) is a visual hint only — it
      // does not commit a selection until the customer clicks the tile.
      // The legacy `autoSelectRecommended` config field is intentionally
      // ignored here so existing installs that have it set to true don't
      // continue to bypass the explicit-choice gate.
      if (!viewedTrackedRef.current) {
        viewedTrackedRef.current = true;
        api.trackViewed(
          slots
            .filter((s) => s.recommended)
            .map((s) => ({ type: "slot", id: s.slotId, recommendationScore: s.recommendationScore }))
        );
      }
    } catch (err) {
      state.error.value = (err as Error).message ?? "Could not load slots";
    } finally {
      state.loading.value = { ...state.loading.value, slots: false };
    }
  }

  async function loadLocations(postcode?: string) {
    state.loading.value = { ...state.loading.value, locations: true };
    state.error.value = null;
    try {
      const res = await api.fetchLocations(
        postcode ?? state.postcode.value ?? undefined,
        state.fulfillment.value,
      );
      const sorted = res.locations.slice().sort((a, b) => b.recommendationScore - a.recommendationScore);
      state.pickupLocations.value = sorted;
      const top = sorted.find((l) => l.recommended) ?? sorted[0] ?? null;
      if (top) {
        state.selectedLocation.value = top;
        await loadSlots(top.locationId);
      }
    } catch (err) {
      state.error.value = (err as Error).message ?? "Could not load locations";
    } finally {
      state.loading.value = { ...state.loading.value, locations: false };
    }
  }

  function handleSelectSlot(slot: Slot) {
    const wasSelectedFromAlternatives =
      state.slots.value.findIndex((s) => s.slotId === slot.slotId) === -1;
    state.selectedSlot.value = slot;
    api.trackSelected({
      type: "slot",
      id: slot.slotId,
      recommendationScore: slot.recommendationScore,
      wasRecommended: slot.recommended,
      alternativesShown: wasSelectedFromAlternatives
        ? undefined
        : state.slots.value.slice(0, 3).map((s) => s.slotId),
    });
  }

  function handleSelectLocation(loc: RecommendedLocation) {
    state.selectedLocation.value = loc;
    state.selectedSlot.value = null;
    api.trackSelected({
      type: "location",
      id: loc.locationId,
      recommendationScore: loc.recommendationScore,
      wasRecommended: loc.recommended,
    });
    void loadSlots(loc.locationId);
  }

  // Derived data
  const selectedDate = state.selectedDate.value;
  const slotsForDate = selectedDate
    ? state.slots.value.filter((s) => s.date === selectedDate)
    : state.slots.value;
  const isPickup = state.fulfillment.value === "pickup";
  const eligible = state.postcodeChecked.value
    ? state.servicesAvailable.value[state.fulfillment.value]
    : null;
  // Delivery: gated on a successful postcode check.
  // Pickup: gated on a selected pickup location (no postcode required).
  const showSlots = isPickup
    ? !!state.selectedLocation.value
    : state.postcodeChecked.value && eligible !== false;

  const selectedSlot = state.selectedSlot.value;
  const alternatives = selectedSlot && selectedSlot.capacityRemaining <= 0
    ? state.slots.value
        .filter((s) => s.slotId !== selectedSlot.slotId && s.capacityRemaining > 0)
        .slice(0, 3)
    : [];

  return (
    <section class="ordak-block" aria-label={config.headingText}>
      <h2 class="ordak-heading">{config.headingText}</h2>

      <Toggle
        value={state.fulfillment.value}
        onChange={(next) => {
          state.fulfillment.value = next;
        }}
      />

      {!isPickup && config.showPostcodeField ? (
        <PostcodeField
          initial={state.postcode.value}
          loading={state.loading.value.eligibility}
          message={state.eligibilityMessage.value}
          eligible={eligible}
          onSubmit={(p) => void handleCheckPostcode(p)}
        />
      ) : null}

      {isPickup && state.loading.value.locations ? (
        <p class="ordak-loading" role="status">Loading pickup locations…</p>
      ) : null}

      {isPickup && state.pickupLocations.value.length ? (
        <LocationList
          locations={state.pickupLocations.value}
          selectedId={state.selectedLocation.value?.locationId ?? null}
          onSelect={handleSelectLocation}
        />
      ) : null}

      {isPickup &&
      !state.loading.value.locations &&
      !state.pickupLocations.value.length ? (
        <p class="ordak-empty">No pickup locations available.</p>
      ) : null}

      {showSlots ? (
        <>
          <DatePicker
            value={selectedDate}
            onChange={(iso) => (state.selectedDate.value = iso)}
            label={isPickup ? "Pickup date" : "Delivery date"}
            hint={config.daysAvailableHint}
          />
          {state.loading.value.slots ? (
            <p class="ordak-loading" role="status">Loading…</p>
          ) : isPickup ? (
            slotsForDate.length === 0 ? (
              <p class="ordak-empty">Pickup not available on this date. Try another.</p>
            ) : (
              <p class="ordak-pickup-banner" role="status">
                {config.pickupInstructions}
              </p>
            )
          ) : slotsForDate.length === 0 ? (
            <p class="ordak-empty">No slots available for this date. Try another.</p>
          ) : (
            <SlotGrid
              slots={slotsForDate}
              selectedId={selectedSlot?.slotId ?? null}
              onSelect={handleSelectSlot}
              showRecommendedBadge={state.widgetAppearance.value.showRecommendedBadge}
              showMostAvailableBadge={state.widgetAppearance.value.showMostAvailableBadge}
            />
          )}
          {!isPickup ? (
            <AlternativeSlots alternatives={alternatives} onPick={handleSelectSlot} />
          ) : null}
        </>
      ) : null}

      {state.error.value ? (
        <p class="ordak-error" role="alert">{state.error.value}</p>
      ) : null}
    </section>
  );
}
