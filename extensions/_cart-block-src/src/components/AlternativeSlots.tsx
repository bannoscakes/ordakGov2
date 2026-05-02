import type { Slot } from "../types";

interface Props {
  alternatives: Slot[];
  onPick: (slot: Slot) => void;
}

export function AlternativeSlots({ alternatives, onPick }: Props) {
  if (!alternatives.length) return null;
  return (
    <div class="ordak-alts" role="region" aria-label="Alternative times">
      <p class="ordak-alts__intro">This time is fully booked. We recommend:</p>
      <ul class="ordak-alts__list">
        {alternatives.slice(0, 3).map((slot) => (
          <li key={slot.slotId}>
            <button
              type="button"
              class="ordak-alts__btn"
              onClick={() => onPick(slot)}
            >
              <span>
                {slot.date} · {slot.timeStart.slice(0, 5)}–{slot.timeEnd.slice(0, 5)}
              </span>
              {slot.reason ? <span class="ordak-alts__reason">{slot.reason}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
