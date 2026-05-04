import type { Slot } from "../types";

interface Props {
  slots: Slot[];
  selectedId: string | null;
  onSelect: (slot: Slot) => void;
}

function formatRange(start: string, end: string): string {
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

function spotsLabel(remaining: number): string {
  if (remaining <= 0) return "Fully booked";
  if (remaining === 1) return "1 spot left";
  return `${remaining} spots left`;
}

function priceAdjustmentLabel(raw: string): string | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `+$${n.toFixed(2)}`;
}

export function SlotGrid({ slots, selectedId, onSelect }: Props) {
  if (!slots.length) {
    return (
      <p class="ordak-empty" role="status">
        No available slots. Please try a different date.
      </p>
    );
  }

  return (
    <ul class="ordak-slots" role="listbox" aria-label="Choose a time slot">
      {slots.map((slot) => {
        const full = slot.capacityRemaining <= 0;
        const isSelected = slot.slotId === selectedId;
        // Badge intentionally hidden — the reason text below conveys
        // ranking instead. The merchant can re-enable via widget appearance
        // settings once those exist.
        const cls = [
          "ordak-slot",
          isSelected ? "ordak-slot--active" : "",
          full ? "ordak-slot--full" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <li class="ordak-slots__item" key={slot.slotId}>
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-disabled={full}
              disabled={full}
              class={cls}
              onClick={() => !full && onSelect(slot)}
            >
              <span class="ordak-slot__time">{formatRange(slot.timeStart, slot.timeEnd)}</span>
              <span class="ordak-slot__spots">{spotsLabel(slot.capacityRemaining)}</span>
              {priceAdjustmentLabel(slot.priceAdjustment) ? (
                <span class="ordak-slot__price">{priceAdjustmentLabel(slot.priceAdjustment)}</span>
              ) : null}
              {slot.reason ? (
                <span class="ordak-slot__reason">{slot.reason}</span>
              ) : null}
              {full ? <span class="ordak-slot__overlay" aria-hidden="true">Fully booked</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
