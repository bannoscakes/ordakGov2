import { useState } from "preact/hooks";

interface Props {
  initial: string;
  onSubmit: (postcode: string) => void;
  loading: boolean;
  message: string | null;
  eligible: boolean | null;
}

export function PostcodeField({ initial, onSubmit, loading, message, eligible }: Props) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  const canSubmit = trimmed.length >= 2 && !loading;

  return (
    <form
      class="ordak-postcode"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(trimmed);
      }}
    >
      <label class="ordak-postcode__label" for="ordak-postcode-input">
        Postcode
      </label>
      <div class="ordak-postcode__row">
        <input
          id="ordak-postcode-input"
          class="ordak-postcode__input"
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="Enter your postcode"
          value={value}
          onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
          aria-invalid={eligible === false}
          aria-describedby={message ? "ordak-postcode-msg" : undefined}
        />
        <button
          type="submit"
          class="ordak-btn ordak-btn--primary"
          disabled={!canSubmit}
          aria-busy={loading}
        >
          {loading ? "Checking…" : "Check availability"}
        </button>
      </div>
      {message ? (
        <p
          id="ordak-postcode-msg"
          class={`ordak-postcode__msg ordak-postcode__msg--${eligible ? "ok" : "error"}`}
          role={eligible === false ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
