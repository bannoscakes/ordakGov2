import { dateRangeFromToday } from "../state";

interface Props {
  value: string | null;
  onChange: (iso: string) => void;
  label: string;
  hint?: string;
}

export function DatePicker({ value, onChange, label, hint }: Props) {
  const range = dateRangeFromToday.value;
  return (
    <div class="ordak-datepicker">
      <label class="ordak-datepicker__label" htmlFor="ordak-date-input">{label}</label>
      <input
        id="ordak-date-input"
        type="date"
        class="ordak-date-input"
        value={value ?? ""}
        min={range.start}
        max={range.end}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
      />
      {hint ? <p class="ordak-datepicker__hint">{hint}</p> : null}
    </div>
  );
}
