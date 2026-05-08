import { useEffect, useMemo, useState } from "react";
import { useNavigation, useSearchParams, useSubmit } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  InlineStack,
  Modal,
  Text,
  TextField,
} from "@shopify/polaris";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type SlotTemplateRow = {
  id: string | null;
  timeStart: string;
  timeEnd: string;
  capacity: number;
  priceAdjustment: number;
  // Storage is minutes (NULL = no cutoff). The editor input is in hours
  // (decimal, so 0.5 = 30 min) but the row state mirrors the storage shape.
  cutoffOffsetMinutes: number | null;
  isActive: boolean;
};

export type SlotsEditorTemplate = {
  id: string;
  timeStart: string;
  timeEnd: string;
  capacity: number;
  priceAdjustment: string;
  cutoffOffsetMinutes: number | null;
  isActive: boolean;
};

export type SlotsEditorVariant = "delivery" | "pickup";

type SlotsEditorProps = {
  variant: SlotsEditorVariant;
  templatesByDay: SlotsEditorTemplate[][];
  saveIntent: string;
  copyIntent: string;
};

const COPY: Record<SlotsEditorVariant, {
  header: string;
  helpText: string;
  emptyAllText: string;
  defaultRow: () => Omit<SlotTemplateRow, "id" | "isActive">;
  showPriceAdjustment: boolean;
}> = {
  delivery: {
    header: "Time slots & limits — Delivery",
    helpText:
      "Set the time windows this zone accepts delivery orders, per day of the week. " +
      "Each row is a slot the customer can pick. Capacity = max orders per slot. " +
      "Price adjustment = extra fee added to the zone's base price for that slot. " +
      "Cutoff (hrs) = hide this slot from the storefront N hours before its start time " +
      "(e.g. 4 = no orders less than 4 h before; blank = no cutoff).",
    emptyAllText:
      "No slots configured yet. Pick a day below and add time windows. Slots " +
      "materialize automatically for the next 14 days when you save.",
    defaultRow: () => ({ timeStart: "09:00", timeEnd: "11:00", capacity: 10, priceAdjustment: 0, cutoffOffsetMinutes: null }),
    showPriceAdjustment: true,
  },
  pickup: {
    header: "Pickup hours & daily capacity",
    helpText:
      "Set the days and hours customers can collect from this location. " +
      "Customers see only the date in the cart-block (the times communicate when " +
      "the location is open via the cart-block's pickup banner setting). " +
      "Capacity is the max number of pickups per window per day. " +
      "Cutoff (hrs) = hide this window from the storefront N hours before its start " +
      "(e.g. 12 = no same-day after 12 h before opening; blank = no cutoff).",
    emptyAllText:
      "No pickup hours configured yet. Pick a day below and add a window — " +
      "most stores use one full-day window like 09:00–17:00. Slots materialize " +
      "automatically for the next 14 days when you save.",
    defaultRow: () => ({ timeStart: "09:00", timeEnd: "17:00", capacity: 20, priceAdjustment: 0, cutoffOffsetMinutes: null }),
    showPriceAdjustment: false,
  },
};

export function SlotsEditor({ variant, templatesByDay, saveIntent, copyIntent }: SlotsEditorProps) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isLoading = navigation.state === "submitting";
  const copy = COPY[variant];

  const dayParam = searchParams.get("day");
  const initialDay = dayParam !== null ? parseInt(dayParam, 10) : 1;
  const [selectedDay, setSelectedDay] = useState(
    Number.isFinite(initialDay) && initialDay >= 0 && initialDay <= 6 ? initialDay : 1,
  );

  const [rowsByDay, setRowsByDay] = useState<SlotTemplateRow[][]>(() =>
    templatesByDay.map((day) =>
      day.map((t) => ({
        id: t.id,
        timeStart: t.timeStart,
        timeEnd: t.timeEnd,
        capacity: t.capacity,
        priceAdjustment: parseFloat(t.priceAdjustment),
        cutoffOffsetMinutes: t.cutoffOffsetMinutes,
        isActive: t.isActive,
      })),
    ),
  );

  // Re-sync local state from props ONLY when the server-side content
  // actually changes (e.g. after a successful save → loader revalidation).
  // Depending on `templatesByDay` reference identity caused unrelated Remix
  // revalidations to wipe in-progress edits on existing rows — newly added
  // rows survived because they had no server-side counterpart to reset to.
  // The content-derived key compares values, so a re-render with the same
  // data is a no-op and the user's local edits stay intact.
  const templatesByDayKey = useMemo(
    () =>
      templatesByDay
        .map((day) =>
          day
            .map(
              (t) =>
                `${t.id}|${t.timeStart}|${t.timeEnd}|${t.capacity}|${t.priceAdjustment}|${t.cutoffOffsetMinutes ?? "_"}|${t.isActive}`,
            )
            .join(","),
        )
        .join("||"),
    [templatesByDay],
  );

  useEffect(() => {
    setRowsByDay(
      templatesByDay.map((day) =>
        day.map((t) => ({
          id: t.id,
          timeStart: t.timeStart,
          timeEnd: t.timeEnd,
          capacity: t.capacity,
          priceAdjustment: parseFloat(t.priceAdjustment),
          cutoffOffsetMinutes: t.cutoffOffsetMinutes,
          isActive: t.isActive,
        })),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templatesByDayKey]);

  const rows = rowsByDay[selectedDay] ?? [];

  const updateRow = (idx: number, patch: Partial<SlotTemplateRow>) => {
    setRowsByDay((prev) => {
      const next = prev.map((d) => d.slice());
      next[selectedDay] = next[selectedDay].map((r, i) => (i === idx ? { ...r, ...patch } : r));
      return next;
    });
  };

  const addRow = () => {
    setRowsByDay((prev) => {
      const next = prev.map((d) => d.slice());
      const day = next[selectedDay];
      const preset = copy.defaultRow();
      // For delivery the typical pattern is back-to-back 2h windows, so seed
      // the next row from the previous row's end time. For pickup the typical
      // pattern is one whole-day window, so use the preset as-is.
      const seedFromPrev = variant === "delivery" && day.length > 0;
      const timeStart = seedFromPrev ? day[day.length - 1].timeEnd : preset.timeStart;
      const timeEnd = seedFromPrev ? addHours(timeStart, 2) : preset.timeEnd;
      day.push({
        id: null,
        timeStart,
        timeEnd,
        capacity: preset.capacity,
        priceAdjustment: preset.priceAdjustment,
        cutoffOffsetMinutes: preset.cutoffOffsetMinutes,
        isActive: true,
      });
      return next;
    });
  };

  const removeRow = (idx: number) => {
    setRowsByDay((prev) => {
      const next = prev.map((d) => d.slice());
      next[selectedDay] = next[selectedDay].filter((_, i) => i !== idx);
      return next;
    });
  };

  const clearDay = () => {
    setRowsByDay((prev) => {
      const next = prev.map((d) => d.slice());
      next[selectedDay] = [];
      return next;
    });
  };

  const onSave = () => {
    const fd = new FormData();
    fd.append("intent", saveIntent);
    fd.append("dayOfWeek", String(selectedDay));
    fd.append(
      "rows",
      JSON.stringify(
        rows.map((r) => ({
          timeStart: r.timeStart,
          timeEnd: r.timeEnd,
          capacity: r.capacity,
          priceAdjustment: r.priceAdjustment,
          cutoffOffsetMinutes: r.cutoffOffsetMinutes,
          isActive: r.isActive,
        })),
      ),
    );
    submit(fd, { method: "post" });
  };

  const onCopyToOtherDays = (targets: number[]) => {
    if (targets.length === 0) return;
    const fd = new FormData();
    fd.append("intent", copyIntent);
    fd.append("fromDayOfWeek", String(selectedDay));
    fd.append("toDaysOfWeek", targets.join(","));
    submit(fd, { method: "post" });
  };

  const totalRows = rowsByDay.reduce((n, d) => n + d.length, 0);

  return (
    <div className="ordak-slots-editor">
      <BlockStack gap="400">
      {/* Hide browser-native spinner arrows on number inputs inside the slot
          editor. They eat ~20 px per column for no real value — typing is
          faster than clicking the arrows, and we control min/max via Polaris.
          Scoped with a class so it doesn't affect number inputs elsewhere. */}
      <style>{`
        .ordak-slots-editor input[type="number"]::-webkit-inner-spin-button,
        .ordak-slots-editor input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .ordak-slots-editor input[type="number"] {
          -moz-appearance: textfield;
        }
      `}</style>
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">{copy.header}</Text>
          <Text as="p" tone="subdued" variant="bodySm">{copy.helpText}</Text>
          {totalRows === 0 && (
            <Banner tone="info">{copy.emptyAllText}</Banner>
          )}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <DayTabs selected={selectedDay} onSelect={setSelectedDay} rowsByDay={rowsByDay} />

          <BlockStack gap="200">
            {rows.length === 0 ? (
              <Banner tone="info">No slots for {DAY_FULL[selectedDay]}. Click &quot;Add slot&quot; below.</Banner>
            ) : (
              rows.map((r, i) => (
                <SlotRowEditor
                  key={`${selectedDay}-${i}`}
                  row={r}
                  showPriceAdjustment={copy.showPriceAdjustment}
                  onChange={(patch) => updateRow(i, patch)}
                  onRemove={() => removeRow(i)}
                />
              ))
            )}
          </BlockStack>

          <InlineStack align="space-between" blockAlign="center">
            <ButtonGroup>
              <Button onClick={addRow}>Add slot</Button>
              {rows.length > 0 && <Button onClick={clearDay} tone="critical">Clear all</Button>}
            </ButtonGroup>
            <ButtonGroup>
              <CopyToDaysButton
                fromDay={selectedDay}
                onCopy={onCopyToOtherDays}
                disabled={rows.length === 0}
                isLoading={isLoading}
              />
              <Button variant="primary" onClick={onSave} loading={isLoading} disabled={isLoading}>
                Save {DAY_FULL[selectedDay]}
              </Button>
            </ButtonGroup>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
    </div>
  );
}

function DayTabs({
  selected,
  onSelect,
  rowsByDay,
}: {
  selected: number;
  onSelect: (n: number) => void;
  rowsByDay: SlotTemplateRow[][];
}) {
  return (
    <InlineStack gap="100">
      {DAY_LABELS.map((label, idx) => {
        const count = rowsByDay[idx]?.length ?? 0;
        const active = idx === selected;
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onSelect(idx)}
            style={{
              padding: "8px 14px",
              border: active
                ? "1px solid var(--p-color-bg-fill-brand, #1a1a1a)"
                : "1px solid var(--p-color-border, #d4d4d4)",
              background: active ? "var(--p-color-bg-fill-brand, #1a1a1a)" : "transparent",
              color: active ? "var(--p-color-text-inverse, #fff)" : "var(--p-color-text, #1a1a1a)",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: active ? 600 : 400,
            }}
          >
            {label}
            {count > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  padding: "0 6px",
                  background: active ? "rgba(255,255,255,0.25)" : "var(--p-color-bg-surface-selected, #f1f1f1)",
                  color: active ? "var(--p-color-text-inverse, #fff)" : "var(--p-color-text-subdued, #6d7175)",
                  borderRadius: 10,
                  fontSize: "11px",
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </InlineStack>
  );
}

function SlotRowEditor({
  row,
  showPriceAdjustment,
  onChange,
  onRemove,
}: {
  row: SlotTemplateRow;
  showPriceAdjustment: boolean;
  onChange: (patch: Partial<SlotTemplateRow>) => void;
  onRemove: () => void;
}) {
  // Layout note: time inputs (HH:MM with clock icon) have intrinsic width
  // ~115 px and don't compress well below that. Number inputs need at least
  // ~80 px to show 2-3 digit values plus the spinner arrows. Using flex: 1
  // on every cell squeezed the number inputs down to ~70 px — values were
  // physically clipped and looked like ghost characters even though the
  // React state was correct. The grid below pins time columns to a fixed
  // width and gives number columns a floor + room to grow.
  //
  // Total minimum at narrow card widths (with spinner arrows hidden via the
  // .ordak-slots-editor scoped CSS in the parent component):
  //   100 + 100 + 80 + 95 + 80 + ~70 (badge.small) + ~32 (icon-only remove) + 8*6 (gaps) ≈ 605 px
  // Comfortable fit inside the standard Polaris Page card width even on
  // narrower viewports. At wider widths the 1fr columns grow to use the
  // available space.
  return (
    <Card>
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            showPriceAdjustment
              ? "100px 100px minmax(80px,1fr) minmax(95px,1fr) minmax(80px,1fr) auto auto"
              : "100px 100px minmax(80px,1fr) minmax(80px,1fr) auto auto",
          gap: "8px",
          alignItems: "end",
        }}
      >
        <TextField
          label="Start"
          value={row.timeStart}
          onChange={(v) => onChange({ timeStart: v })}
          type="time"
          autoComplete="off"
        />
        <TextField
          label="End"
          value={row.timeEnd}
          onChange={(v) => onChange({ timeEnd: v })}
          type="time"
          autoComplete="off"
        />
        <TextField
          label="Capacity"
          value={String(row.capacity)}
          onChange={(v) => onChange({ capacity: parseInt(v, 10) || 0 })}
          type="number"
          min={1}
          max={9999}
          autoComplete="off"
          selectTextOnFocus
        />
        {showPriceAdjustment && (
          <TextField
            label="Price"
            value={String(row.priceAdjustment)}
            onChange={(v) => onChange({ priceAdjustment: parseFloat(v) || 0 })}
            type="number"
            step={0.01}
            min={0}
            max={9999}
            prefix="$"
            autoComplete="off"
            selectTextOnFocus
          />
        )}
        <TextField
          label="Cutoff"
          value={cutoffMinutesToHoursInput(row.cutoffOffsetMinutes)}
          onChange={(v) => onChange({ cutoffOffsetMinutes: hoursInputToCutoffMinutes(v) })}
          type="number"
          step={0.25}
          min={0}
          max={24}
          placeholder="—"
          autoComplete="off"
          selectTextOnFocus
        />
        <div style={{ paddingBottom: 4 }}>
          <Badge tone={row.id ? "success" : undefined} size="small">{row.id ? "Saved" : "New"}</Badge>
        </div>
        <div style={{ paddingBottom: 4 }}>
          <Button onClick={onRemove} tone="critical" size="slim" accessibilityLabel="Remove slot">✕</Button>
        </div>
      </div>
    </Card>
  );
}

function CopyToDaysButton({
  fromDay,
  onCopy,
  disabled,
  isLoading,
}: {
  fromDay: number;
  onCopy: (targets: number[]) => void;
  disabled: boolean;
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<number[]>([]);

  const toggle = (n: number) => {
    setTargets((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled || isLoading}>
        Copy {DAY_FULL[fromDay]} to…
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Copy ${DAY_FULL[fromDay]}'s slots to other days`}
        primaryAction={{
          content: targets.length === 0 ? "Pick at least one day" : `Copy to ${targets.length} day(s)`,
          disabled: targets.length === 0 || isLoading,
          loading: isLoading,
          onAction: () => {
            onCopy(targets);
            setTargets([]);
            setOpen(false);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" tone="subdued">
              Existing slots on the selected days will be replaced with {DAY_FULL[fromDay]}&apos;s
              schedule. Bookings on those days are preserved.
            </Text>
            <BlockStack gap="200">
              {DAY_FULL.map((d, i) => {
                if (i === fromDay) return null;
                return (
                  <Checkbox
                    key={i}
                    label={d}
                    checked={targets.includes(i)}
                    onChange={() => toggle(i)}
                  />
                );
              })}
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}

function addHours(time: string, hours: number): string {
  const [hh, mm] = time.split(":").map((s) => parseInt(s, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return time;
  const total = hh * 60 + mm + hours * 60;
  const newH = Math.min(23, Math.floor(total / 60));
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

// Storage is minutes; the input is hours-with-decimals so merchants type
// "4" for 4h instead of "240" for 240 min. Round-tripping through hours
// also keeps trailing zeros out of the rendered value.
function cutoffMinutesToHoursInput(minutes: number | null): string {
  if (minutes == null) return "";
  return (minutes / 60).toString();
}

function hoursInputToCutoffMinutes(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const hours = parseFloat(trimmed);
  if (!Number.isFinite(hours) || hours < 0) return null;
  // Cap at 24h (1440 min). Anything longer is almost certainly a typo —
  // the merchant probably meant "0.X hours" or hit an extra digit.
  const minutes = Math.min(1440, Math.round(hours * 60));
  return minutes;
}
