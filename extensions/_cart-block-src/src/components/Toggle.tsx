import type { Fulfillment } from "../types";

interface Props {
  value: Fulfillment;
  onChange: (next: Fulfillment) => void;
  disabledTypes?: { delivery?: boolean; pickup?: boolean };
}

export function Toggle({ value, onChange, disabledTypes }: Props) {
  return (
    <div class="ordak-toggle" role="radiogroup" aria-label="Choose fulfillment method">
      <button
        type="button"
        role="radio"
        aria-checked={value === "delivery"}
        class={`ordak-toggle__btn${value === "delivery" ? " ordak-toggle__btn--active" : ""}`}
        disabled={disabledTypes?.delivery}
        onClick={() => onChange("delivery")}
      >
        <span aria-hidden="true">🚚</span> Delivery
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "pickup"}
        class={`ordak-toggle__btn${value === "pickup" ? " ordak-toggle__btn--active" : ""}`}
        disabled={disabledTypes?.pickup}
        onClick={() => onChange("pickup")}
      >
        <span aria-hidden="true">📦</span> Pickup
      </button>
    </div>
  );
}
