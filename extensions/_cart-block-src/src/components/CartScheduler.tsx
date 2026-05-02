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

  // Re-apply cart attributes if the theme drops them after a re-render.
  useEffect(() => listenForCartUpdates(() => void cartWriter.ensure()), []);

  // Whenever the selected slot changes, write attributes.
  useEffect(() => {
    return effect(() => {
      const slot = state.selectedSlot.value;
      const fulfillment = state.fulfillment.value;
      const loc = state.selectedLocation.value;

      void cartWriter.write(
        buildCartPayload({
          fulfillment,
          slotId: slot?.slotId ?? null,
          slotDate: slot?.date ?? null,
          slotTimeStart: slot?.timeStart ?? null,
          slotTimeEnd: slot?.timeEnd ?? null,
          locationId: loc?.locationId ?? slot?.locationId ?? null,
          wasRecommended: slot?.recommended ?? false,
          recommendationScore: slot?.recommendationScore,
        })
      );
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
      state.eligibilityMessage.value = res.message ?? null;
      state.postcodeChecked.value = true;

      if (res.eligible) {
        // Default the date picker to today so it has a sensible initial value
        // before slots come back. The user can change it; slot loading is
        // independent of the picker — slots come for the whole 14-day range
        // and the picker filters which day to show.
        if (!state.selectedDate.value) {
          state.selectedDate.value = dateRangeFromToday.value.start;
        }
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
      // Only override the date if the user / handleCheckPostcode hasn't set
      // one yet. The native date input owns the chosen date — we shouldn't
      // yank it back to whatever the first slot happens to fall on.
      if (!state.selectedDate.value && slots[0]?.date) {
        state.selectedDate.value = slots[0].date;
      }
      if (config.autoSelectRecommended) {
        const top = slots.find((s) => s.recommended && s.capacityRemaining > 0);
        if (top) state.selectedSlot.value = top;
      }
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

  async function loadLocations(postcode: string) {
    state.loading.value = { ...state.loading.value, locations: true };
    state.error.value = null;
    try {
      const res = await api.fetchLocations(postcode, state.fulfillment.value);
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
  const eligible = state.postcodeChecked.value
    ? state.servicesAvailable.value[state.fulfillment.value]
    : null;
  const showSlots =
    state.postcodeChecked.value &&
    eligible !== false &&
    (state.fulfillment.value === "delivery" || state.selectedLocation.value);

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

      {config.showPostcodeField ? (
        <PostcodeField
          initial={state.postcode.value}
          loading={state.loading.value.eligibility}
          message={state.eligibilityMessage.value}
          eligible={eligible}
          onSubmit={(p) => void handleCheckPostcode(p)}
        />
      ) : null}

      {state.fulfillment.value === "pickup" && state.pickupLocations.value.length ? (
        <LocationList
          locations={state.pickupLocations.value}
          selectedId={state.selectedLocation.value?.locationId ?? null}
          onSelect={handleSelectLocation}
        />
      ) : null}

      {showSlots ? (
        <>
          <DatePicker
            value={selectedDate}
            onChange={(iso) => (state.selectedDate.value = iso)}
            label={state.fulfillment.value === "pickup" ? "Pickup date" : "Delivery date"}
            hint="Monday – Saturday only"
          />
          {state.loading.value.slots ? (
            <p class="ordak-loading" role="status">Loading…</p>
          ) : slotsForDate.length === 0 ? (
            <p class="ordak-empty">No slots available for this date. Try another.</p>
          ) : (
            <SlotGrid
              slots={slotsForDate}
              selectedId={selectedSlot?.slotId ?? null}
              onSelect={handleSelectSlot}
            />
          )}
          <AlternativeSlots alternatives={alternatives} onPick={handleSelectSlot} />
        </>
      ) : null}

      {state.error.value ? (
        <p class="ordak-error" role="alert">{state.error.value}</p>
      ) : null}
    </section>
  );
}
