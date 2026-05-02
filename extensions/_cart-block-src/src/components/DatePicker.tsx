import { describeDate } from "../state";

interface Props {
  dates: string[];
  selected: string | null;
  onSelect: (iso: string) => void;
}

export function DatePicker({ dates, selected, onSelect }: Props) {
  if (!dates.length) return null;
  return (
    <div class="ordak-dates" role="listbox" aria-label="Choose a date">
      {dates.map((iso) => {
        const isSelected = iso === selected;
        return (
          <button
            type="button"
            key={iso}
            role="option"
            aria-selected={isSelected}
            class={`ordak-date${isSelected ? " ordak-date--active" : ""}`}
            onClick={() => onSelect(iso)}
          >
            <span class="ordak-date__label">{describeDate(iso)}</span>
            <span class="ordak-date__iso" aria-hidden="true">{iso.slice(5)}</span>
          </button>
        );
      })}
    </div>
  );
}
