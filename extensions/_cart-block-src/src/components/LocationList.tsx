import type { RecommendedLocation } from "../types";

interface Props {
  locations: RecommendedLocation[];
  selectedId: string | null;
  onSelect: (loc: RecommendedLocation) => void;
}

export function LocationList({ locations, selectedId, onSelect }: Props) {
  if (!locations.length) {
    return (
      <p class="ordak-empty" role="status">
        No pickup locations available for this postcode.
      </p>
    );
  }

  return (
    <ul class="ordak-locations" role="listbox" aria-label="Choose a pickup location">
      {locations.map((loc) => {
        const isSelected = loc.locationId === selectedId;
        const full = loc.availableCapacity <= 0;
        const cls = [
          "ordak-location",
          loc.recommended ? "ordak-location--recommended" : "",
          isSelected ? "ordak-location--active" : "",
          full ? "ordak-location--full" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <li class="ordak-locations__item" key={loc.locationId}>
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-disabled={full}
              disabled={full}
              class={cls}
              onClick={() => !full && onSelect(loc)}
            >
              {loc.recommended ? (
                <span class="ordak-badge">Recommended</span>
              ) : null}
              <span class="ordak-location__name">{loc.name}</span>
              <span class="ordak-location__address">{loc.address}</span>
              {typeof loc.distanceKm === "number" ? (
                <span class="ordak-location__distance">{loc.distanceKm.toFixed(1)} km away</span>
              ) : null}
              {loc.recommended && loc.reason ? (
                <span class="ordak-location__reason">{loc.reason}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
