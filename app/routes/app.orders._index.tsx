import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  Button,
  EmptyState,
  BlockStack,
  InlineStack,
  Text,
  Select,
  Tabs,
  Modal,
  ButtonGroup,
} from "@shopify/polaris";
import { ChevronLeftIcon, ChevronRightIcon } from "@shopify/polaris-icons";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

const PAGE_SIZE = 20;
const MAX_DAY_TILES_VISIBLE = { month: 4, week: 12 } as const;
const MODAL_DAY_LIST_CAP = 50;

type ViewMode = "calendar" | "list";
type CalendarRange = "month" | "week";

function isViewMode(v: string | null): v is ViewMode {
  return v === "calendar" || v === "list";
}

function isCalendarRange(v: string | null): v is CalendarRange {
  return v === "month" || v === "week";
}

function parseMonth(raw: string | null): { year: number; month: number } {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split("-").map((s) => parseInt(s, 10));
    // Bound year to a sane range so a stale link with year=0 doesn't quietly
    // render an empty Dec 1900 calendar (JS Date remaps years 0-99 to 1900s).
    if (m >= 1 && m <= 12 && y >= 2000 && y <= 2100) return { year: y, month: m - 1 };
    logger.warn("Orders calendar: invalid ?month, falling back to current", { raw });
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function parseWeekAnchor(raw: string | null): Date {
  // ?week=YYYY-MM-DD pins the week containing that date. Fallback to today.
  // Range-validate every component AND verify the constructed Date didn't
  // get normalized by JS — `new Date(2026, 1, 30)` silently rolls to Mar 2,
  // so `isNaN` alone never trips. Without the round-trip check the fallback
  // is dead code and a malformed link silently lands on a wrong week.
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map((s) => parseInt(s, 10));
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(y, m - 1, d);
      if (
        !isNaN(dt.getTime()) &&
        dt.getFullYear() === y &&
        dt.getMonth() === m - 1 &&
        dt.getDate() === d
      ) {
        return dt;
      }
    }
    logger.warn("Orders calendar: invalid ?week, falling back to today", { raw });
  }
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  try {
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });
    if (!shop) {
      throw new Response("Shop not found — reinstall the app", { status: 404 });
    }

    const url = new URL(request.url);
    const view: ViewMode = isViewMode(url.searchParams.get("view"))
      ? (url.searchParams.get("view") as ViewMode)
      : "calendar";
    const { year, month } = parseMonth(url.searchParams.get("month"));

    if (view === "calendar") {
      const range: CalendarRange = isCalendarRange(url.searchParams.get("range"))
        ? (url.searchParams.get("range") as CalendarRange)
        : "month";

      // TZ note: dates use the SERVER's local timezone throughout (loader,
      // materializer, cart-block all do the same). Production migration to
      // a UTC-only server (Phase E) needs a Shop-tz-aware rewrite of this +
      // the materializer; flagged separately, not this PR's scope.
      let gridStart: Date;
      let gridEnd: Date;
      let monthStart: Date;
      let monthEnd: Date;
      let monthLabel: string;
      let weekAnchor: Date | null = null;

      if (range === "week") {
        weekAnchor = parseWeekAnchor(url.searchParams.get("week"));
        // Anchor to Monday of the week containing weekAnchor.
        gridStart = new Date(weekAnchor);
        const dow = gridStart.getDay();
        const back = (dow + 6) % 7;
        gridStart.setDate(gridStart.getDate() - back);
        gridStart.setHours(0, 0, 0, 0);
        gridEnd = new Date(gridStart);
        gridEnd.setDate(gridEnd.getDate() + 6);
        gridEnd.setHours(23, 59, 59, 999);
        monthStart = gridStart;
        monthEnd = gridEnd;
        monthLabel = `${gridStart.toLocaleDateString("en-AU", { month: "short", day: "numeric" })} – ${gridEnd.toLocaleDateString("en-AU", { month: "short", day: "numeric", year: "numeric" })}`;
      } else {
        // Render a fixed 6-week (42-cell) grid — Monday-anchored — so the
        // grid size doesn't fluctuate. Earlier "shrink to needed weeks" math
        // had a case where months ending on a Monday (Aug 2026) lost their
        // last day. Six weeks always covers any month.
        monthStart = new Date(year, month, 1);
        monthEnd = new Date(year, month + 1, 0);
        gridStart = new Date(monthStart);
        const dow = gridStart.getDay();
        const back = (dow + 6) % 7;
        gridStart.setDate(gridStart.getDate() - back);
        gridEnd = new Date(gridStart);
        gridEnd.setDate(gridEnd.getDate() + 41);
        gridEnd.setHours(23, 59, 59, 999);
        monthLabel = monthStart.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
      }

      const [orders, slotsForRange] = await Promise.all([
        prisma.orderLink.findMany({
          where: {
            slot: {
              location: { shopId: shop.id },
              date: { gte: gridStart, lte: gridEnd },
            },
          },
          include: {
            slot: {
              include: { location: { select: { id: true, name: true } } },
            },
          },
          orderBy: [{ slot: { date: "asc" } }],
        }),
        prisma.slot.findMany({
          where: {
            location: { shopId: shop.id },
            date: { gte: gridStart, lte: gridEnd },
            isActive: true,
          },
          select: { date: true, capacity: true, booked: true, fulfillmentType: true },
        }),
      ]);

      const ordersByDate: Record<string, Array<{
        id: string;
        shopifyOrderId: string;
        shopifyOrderNumber: string | null;
        status: string;
        fulfillmentType: string;
        timeStart: string;
        timeEnd: string;
        locationName: string;
      }>> = {};
      for (const o of orders) {
        const key = formatLocalDate(new Date(o.slot.date));
        if (!ordersByDate[key]) ordersByDate[key] = [];
        ordersByDate[key].push({
          id: o.id,
          shopifyOrderId: o.shopifyOrderId,
          shopifyOrderNumber: o.shopifyOrderNumber,
          status: o.status,
          fulfillmentType: o.fulfillmentType,
          timeStart: o.slot.timeStart,
          timeEnd: o.slot.timeEnd,
          locationName: o.slot.location.name,
        });
      }

      // Capacity tracked per fulfillmentType so the merchant can see two
      // pills per day (delivery utilisation + pickup utilisation) instead of
      // one summed-across-zones-and-types number that hid sold-out windows.
      const capacityByDate: Record<
        string,
        {
          delivery: { booked: number; capacity: number };
          pickup: { booked: number; capacity: number };
        }
      > = {};
      for (const s of slotsForRange) {
        const key = formatLocalDate(new Date(s.date));
        if (!capacityByDate[key]) {
          capacityByDate[key] = {
            delivery: { booked: 0, capacity: 0 },
            pickup: { booked: 0, capacity: 0 },
          };
        }
        const bucket = s.fulfillmentType === "pickup"
          ? capacityByDate[key].pickup
          : capacityByDate[key].delivery;
        bucket.booked += s.booked;
        bucket.capacity += s.capacity;
      }

      const days: string[] = [];
      const cursor = new Date(gridStart);
      while (cursor <= gridEnd) {
        days.push(formatLocalDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }

      // Range navigation params. Month mode walks by calendar month;
      // week mode walks by 7-day blocks anchored on the current week's
      // Monday.
      let prevParam: string;
      let nextParam: string;
      let thisParam: string;
      if (range === "week" && weekAnchor) {
        const prev = new Date(weekAnchor);
        prev.setDate(prev.getDate() - 7);
        const next = new Date(weekAnchor);
        next.setDate(next.getDate() + 7);
        prevParam = formatLocalDate(prev);
        nextParam = formatLocalDate(next);
        thisParam = formatLocalDate(new Date());
      } else {
        prevParam = formatMonthParam(year, month - 1);
        nextParam = formatMonthParam(year, month + 1);
        thisParam = formatMonthParam(new Date().getFullYear(), new Date().getMonth());
      }

      return json({
        view: "calendar" as const,
        range,
        rangeLabel: monthLabel,
        prevParam,
        nextParam,
        thisParam,
        days,
        ordersByDate,
        capacityByDate,
        gridStart: formatLocalDate(gridStart),
        gridEnd: formatLocalDate(gridEnd),
        monthStart: formatLocalDate(monthStart),
        monthEnd: formatLocalDate(monthEnd),
        today: formatLocalDate(new Date()),
      });
    }

    // List view — paginated, ordered by due date so newest-due lands at top.
    const statusFilter = url.searchParams.get("status") || "all";
    const typeFilter = url.searchParams.get("type") || "all";
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));

    const where: {
      slot: { location: { shopId: string } };
      status?: string;
      fulfillmentType?: string;
    } = { slot: { location: { shopId: shop.id } } };
    if (statusFilter !== "all") where.status = statusFilter;
    if (typeFilter !== "all") where.fulfillmentType = typeFilter;

    const [orders, total] = await Promise.all([
      prisma.orderLink.findMany({
        where,
        include: {
          slot: {
            include: { location: { select: { id: true, name: true, city: true } } },
          },
        },
        orderBy: [{ slot: { date: "desc" } }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.orderLink.count({ where }),
    ]);

    return json({
      view: "list" as const,
      orders: orders.map((o) => ({
        id: o.id,
        shopifyOrderId: o.shopifyOrderId,
        shopifyOrderNumber: o.shopifyOrderNumber,
        status: o.status,
        fulfillmentType: o.fulfillmentType,
        slot: {
          date: o.slot.date.toISOString(),
          timeStart: o.slot.timeStart,
          timeEnd: o.slot.timeEnd,
          locationName: o.slot.location.name,
          locationCity: o.slot.location.city,
        },
      })),
      pagination: { page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total },
      filters: { status: statusFilter, type: typeFilter },
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    logger.error("Orders index loader failed", error, { shop: session.shop });
    throw error;
  }
}

function formatMonthParam(year: number, monthIndex: number): string {
  const d = new Date(year, monthIndex, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DELIVERY_COLOR = "#3b82f6";
const PICKUP_COLOR = "#1a8917";

type DayOrder = {
  id: string;
  shopifyOrderId: string;
  shopifyOrderNumber: string | null;
  status: string;
  fulfillmentType: string;
  timeStart: string;
  timeEnd: string;
  locationName: string;
};

export default function OrdersIndex() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabIndex = data.view === "calendar" ? 0 : 1;

  function setView(idx: number) {
    const next = new URLSearchParams(searchParams);
    next.set("view", idx === 0 ? "calendar" : "list");
    next.delete("page");
    setSearchParams(next);
  }

  return (
    <Page title="Scheduled orders" backAction={{ content: "Dashboard", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <Tabs
              tabs={[
                { id: "calendar", content: "Calendar" },
                { id: "list", content: "List" },
              ]}
              selected={tabIndex}
              onSelect={setView}
            />
            <div style={{ padding: 16 }}>
              {data.view === "calendar" ? (
                <CalendarView data={data} navigate={navigate} setSearchParams={setSearchParams} searchParams={searchParams} />
              ) : (
                <ListView data={data} navigate={navigate} searchParams={searchParams} setSearchParams={setSearchParams} />
              )}
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// ---------- Calendar view ----------

type CalendarData = Extract<ReturnType<typeof useLoaderData<typeof loader>>, { view: "calendar" }>;

function CalendarView({
  data,
  navigate,
  searchParams,
  setSearchParams,
}: {
  data: CalendarData;
  navigate: (to: string) => void;
  searchParams: URLSearchParams;
  setSearchParams: (next: URLSearchParams) => void;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);

  function gotoRange(param: string) {
    const next = new URLSearchParams(searchParams);
    next.set("view", "calendar");
    if (data.range === "week") {
      next.set("range", "week");
      next.set("week", param);
      next.delete("month");
    } else {
      next.set("range", "month");
      next.set("month", param);
      next.delete("week");
    }
    setSearchParams(next);
  }

  function setRange(r: "month" | "week") {
    const next = new URLSearchParams(searchParams);
    next.set("view", "calendar");
    next.set("range", r);
    if (r === "week") {
      next.set("week", data.today);
      next.delete("month");
    } else {
      next.delete("week");
    }
    setSearchParams(next);
  }

  const ordersInOpenDate = openDate ? data.ordersByDate[openDate] ?? [] : [];
  const isWeek = data.range === "week";

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center" wrap>
        <InlineStack gap="200" blockAlign="center">
          <Button icon={ChevronLeftIcon} onClick={() => gotoRange(data.prevParam)} accessibilityLabel={isWeek ? "Previous week" : "Previous month"} />
          <Text as="h2" variant="headingMd">{data.rangeLabel}</Text>
          <Button icon={ChevronRightIcon} onClick={() => gotoRange(data.nextParam)} accessibilityLabel={isWeek ? "Next week" : "Next month"} />
        </InlineStack>
        <InlineStack gap="200" blockAlign="center" wrap>
          <Button onClick={() => gotoRange(data.thisParam)}>Today</Button>
          <ButtonGroup>
            <Button pressed={!isWeek} onClick={() => setRange("month")}>Month</Button>
            <Button pressed={isWeek} onClick={() => setRange("week")}>Week</Button>
          </ButtonGroup>
          <InlineStack gap="200" blockAlign="center">
            <LegendDot color={DELIVERY_COLOR} /><Text as="span" variant="bodySm">Delivery</Text>
            <LegendDot color={PICKUP_COLOR} /><Text as="span" variant="bodySm">Pickup</Text>
          </InlineStack>
        </InlineStack>
      </InlineStack>

      {isWeek ? (
        <WeekColumns
          days={data.days}
          ordersByDate={data.ordersByDate}
          today={data.today}
          onOrderClick={(o) => navigate(`/app/orders/${o.shopifyOrderId}/reschedule`)}
        />
      ) : (
        <MonthGrid
          days={data.days}
          ordersByDate={data.ordersByDate}
          capacityByDate={data.capacityByDate}
          monthStart={data.monthStart}
          monthEnd={data.monthEnd}
          today={data.today}
          onDayClick={(day) => setOpenDate(day)}
        />
      )}

      <Modal
        open={openDate !== null}
        onClose={() => setOpenDate(null)}
        title={openDate ? new Date(openDate + "T00:00:00").toLocaleDateString("en-AU", { weekday: "long", month: "short", day: "numeric", year: "numeric" }) : ""}
        primaryAction={{ content: "Close", onAction: () => setOpenDate(null) }}
      >
        <Modal.Section>
          {ordersInOpenDate.length === 0 ? (
            <Text as="p" tone="subdued">No orders on this date.</Text>
          ) : (
            <BlockStack gap="300">
              {ordersInOpenDate.length > MODAL_DAY_LIST_CAP && (
                <Text as="p" tone="subdued" variant="bodySm">
                  Showing first {MODAL_DAY_LIST_CAP} of {ordersInOpenDate.length}. Switch to List
                  view for filtering and pagination.
                </Text>
              )}
              {ordersInOpenDate.slice(0, MODAL_DAY_LIST_CAP).map((o) => (
                <InlineStack key={o.id} align="space-between" blockAlign="center" gap="300" wrap={false}>
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center" wrap>
                      <Text as="p" fontWeight="semibold">
                        #{o.shopifyOrderNumber || o.shopifyOrderId.slice(-8)}
                      </Text>
                      <Badge tone={o.fulfillmentType === "pickup" ? "success" : "info"}>
                        {o.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}
                      </Badge>
                      <StatusBadge status={o.status} />
                    </InlineStack>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {o.timeStart}–{o.timeEnd} · {o.locationName}
                    </Text>
                  </BlockStack>
                  <Button
                    onClick={() => {
                      setOpenDate(null);
                      navigate(`/app/orders/${o.shopifyOrderId}/reschedule`);
                    }}
                    size="slim"
                  >
                    Reschedule
                  </Button>
                </InlineStack>
              ))}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}

function WeekColumns({
  days,
  ordersByDate,
  today,
  onOrderClick,
}: {
  days: string[];
  ordersByDate: Record<string, DayOrder[]>;
  today: string;
  onOrderClick: (o: DayOrder) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: 0,
      }}
    >
      {days.map((day, idx) => {
        const orders = ordersByDate[day] ?? [];
        const dayNum = parseInt(day.slice(8, 10), 10);
        const isToday = day === today;
        return (
          <div
            key={day}
            style={{
              borderRight: idx < days.length - 1 ? "1px solid #e3e3e3" : "none",
              padding: "12px 12px 24px",
              minWidth: 0,
            }}
          >
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: DELIVERY_COLOR,
                  textTransform: "uppercase",
                }}
              >
                {WEEKDAY_LABELS[idx]}
              </div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 600,
                  color: DELIVERY_COLOR,
                  margin: "4px 0",
                  fontVariantNumeric: "tabular-nums",
                  textDecoration: isToday ? "underline" : "none",
                  textUnderlineOffset: 4,
                }}
              >
                {dayNum}
              </div>
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 12px",
                  background: isToday ? "#dbeafe" : "#f1f5f9",
                  color: isToday ? DELIVERY_COLOR : "#475569",
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {orders.length}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {orders.map((o) => (
                <OrderPill key={o.id} order={o} onClick={() => onOrderClick(o)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrderPill({ order, onClick }: { order: DayOrder; onClick: () => void }) {
  const dotColor = order.fulfillmentType === "pickup" ? PICKUP_COLOR : DELIVERY_COLOR;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${order.timeStart}–${order.timeEnd} · ${order.locationName} · ${order.status}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 12px",
        border: "1px solid #d4d4d8",
        borderRadius: 16,
        background: "#fff",
        fontSize: 13,
        color: DELIVERY_COLOR,
        cursor: "pointer",
        width: "100%",
        textAlign: "left",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          flexShrink: 0,
          background: dotColor,
        }}
      />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        #{order.shopifyOrderNumber || order.shopifyOrderId.slice(-6)}
      </span>
    </button>
  );
}

function MonthGrid({
  days,
  ordersByDate,
  capacityByDate,
  monthStart,
  monthEnd,
  today,
  onDayClick,
}: {
  days: string[];
  ordersByDate: Record<string, DayOrder[]>;
  capacityByDate: Record<
    string,
    {
      delivery: { booked: number; capacity: number };
      pickup: { booked: number; capacity: number };
    }
  >;
  monthStart: string;
  monthEnd: string;
  today: string;
  onDayClick: (day: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
      {WEEKDAY_LABELS.map((label) => (
        <div
          key={label}
          style={{
            padding: "8px 6px",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            color: "var(--p-color-text-subdued, #6d7175)",
            textAlign: "center",
          }}
        >
          {label}
        </div>
      ))}
      {days.map((day) => {
        const inMonth = day >= monthStart && day <= monthEnd;
        const isToday = day === today;
        const orders = ordersByDate[day] ?? [];
        const cap = capacityByDate[day];
        const dayNum = parseInt(day.slice(8, 10), 10);
        return (
          <button
            key={day}
            type="button"
            onClick={() => onDayClick(day)}
            style={{
              minHeight: 100,
              padding: 6,
              background: inMonth ? "#fff" : "#f6f6f7",
              border: isToday ? "2px solid #1a1a1a" : "1px solid #e3e3e3",
              borderRadius: 6,
              textAlign: "left",
              cursor: "pointer",
              opacity: inMonth ? 1 : 0.55,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
              <span style={{ fontWeight: isToday ? 700 : 500, fontSize: 13 }}>{dayNum}</span>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {cap && cap.delivery.capacity > 0 ? (
                  <CapacityPill booked={cap.delivery.booked} capacity={cap.delivery.capacity} color={DELIVERY_COLOR} label="Delivery" />
                ) : null}
                {cap && cap.pickup.capacity > 0 ? (
                  <CapacityPill booked={cap.pickup.booked} capacity={cap.pickup.capacity} color={PICKUP_COLOR} label="Pickup" />
                ) : null}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
              {orders.slice(0, MAX_DAY_TILES_VISIBLE.month).map((o) => (
                <span
                  key={o.id}
                  style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    borderRadius: 10,
                    color: "#fff",
                    background: o.fulfillmentType === "pickup" ? PICKUP_COLOR : DELIVERY_COLOR,
                  }}
                  title={`${o.timeStart}–${o.timeEnd} · ${o.locationName}`}
                >
                  #{o.shopifyOrderNumber || o.shopifyOrderId.slice(-4)}
                </span>
              ))}
              {orders.length > MAX_DAY_TILES_VISIBLE.month ? (
                <span style={{ fontSize: 11, color: "var(--p-color-text-subdued, #6d7175)" }}>
                  +{orders.length - MAX_DAY_TILES_VISIBLE.month} more
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function LegendDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: color }}
    />
  );
}

function CapacityPill({
  booked,
  capacity,
  color,
  label,
}: {
  booked: number;
  capacity: number;
  color: string;
  label: string;
}) {
  const ratio = capacity > 0 ? booked / capacity : 0;
  const tone = ratio >= 1 ? "#dc2626" : ratio >= 0.8 ? "#b45309" : "var(--p-color-text-subdued, #6d7175)";
  return (
    <span
      title={`${label}: ${booked} of ${capacity} booked`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 10,
        color: tone,
      }}
    >
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: color }} />
      {booked}/{capacity}
    </span>
  );
}

// ---------- List view ----------

type ListData = Extract<ReturnType<typeof useLoaderData<typeof loader>>, { view: "list" }>;

function ListView({
  data,
  navigate,
  searchParams,
  setSearchParams,
}: {
  data: ListData;
  navigate: (to: string) => void;
  searchParams: URLSearchParams;
  setSearchParams: (next: URLSearchParams) => void;
}) {
  function updateFilter(key: "status" | "type", value: string) {
    const next = new URLSearchParams(searchParams);
    next.set("view", "list");
    if (value === "all") next.delete(key);
    else next.set(key, value);
    next.delete("page");
    setSearchParams(next);
  }

  function gotoPage(p: number) {
    const next = new URLSearchParams(searchParams);
    next.set("view", "list");
    next.set("page", String(p));
    setSearchParams(next);
  }

  const filtersActive = data.filters.status !== "all" || data.filters.type !== "all";
  if (data.orders.length === 0 && !filtersActive) {
    return (
      <EmptyState
        heading="No scheduled orders yet"
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>Orders with delivery/pickup scheduling will appear here once customers start booking.</p>
      </EmptyState>
    );
  }
  if (data.orders.length === 0 && filtersActive) {
    return (
      <BlockStack gap="400">
        <InlineStack gap="400" wrap>
          <Select
            label="Status"
            options={[
              { label: "All", value: "all" },
              { label: "Scheduled", value: "scheduled" },
              { label: "Updated", value: "updated" },
              { label: "Completed", value: "completed" },
              { label: "Canceled", value: "canceled" },
            ]}
            value={data.filters.status}
            onChange={(v) => updateFilter("status", v)}
          />
          <Select
            label="Type"
            options={[
              { label: "All", value: "all" },
              { label: "Delivery", value: "delivery" },
              { label: "Pickup", value: "pickup" },
            ]}
            value={data.filters.type}
            onChange={(v) => updateFilter("type", v)}
          />
        </InlineStack>
        <EmptyState
          heading="No orders match these filters"
          action={{
            content: "Clear filters",
            onAction: () => {
              const next = new URLSearchParams(searchParams);
              next.set("view", "list");
              next.delete("status");
              next.delete("type");
              next.delete("page");
              setSearchParams(next);
            },
          }}
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>Adjust the status or type filter, or clear them to see everything.</p>
        </EmptyState>
      </BlockStack>
    );
  }

  const rows = data.orders.map((o) => [
    o.shopifyOrderNumber || o.shopifyOrderId.slice(-8),
    formatDate(o.slot.date),
    `${o.slot.timeStart}–${o.slot.timeEnd}`,
    o.slot.locationName + (o.slot.locationCity ? ` • ${o.slot.locationCity}` : ""),
    o.fulfillmentType === "delivery" ? "Delivery" : "Pickup",
    <StatusBadge key={`s-${o.id}`} status={o.status} />,
    <Button key={`b-${o.id}`} onClick={() => navigate(`/app/orders/${o.shopifyOrderId}/reschedule`)} size="slim">
      Reschedule
    </Button>,
  ]);

  return (
    <BlockStack gap="400">
      <InlineStack gap="400" wrap>
        <Select
          label="Status"
          options={[
            { label: "All", value: "all" },
            { label: "Scheduled", value: "scheduled" },
            { label: "Updated", value: "updated" },
            { label: "Completed", value: "completed" },
            { label: "Canceled", value: "canceled" },
          ]}
          value={data.filters.status}
          onChange={(v) => updateFilter("status", v)}
        />
        <Select
          label="Type"
          options={[
            { label: "All", value: "all" },
            { label: "Delivery", value: "delivery" },
            { label: "Pickup", value: "pickup" },
          ]}
          value={data.filters.type}
          onChange={(v) => updateFilter("type", v)}
        />
      </InlineStack>
      <DataTable
        columnContentTypes={["text", "text", "text", "text", "text", "text", "text"]}
        headings={["Order", "Due date", "Time", "Location", "Type", "Status", ""]}
        rows={rows}
      />
      {data.pagination.totalPages > 1 && (
        <InlineStack gap="200" align="end">
          <Button disabled={data.pagination.page <= 1} onClick={() => gotoPage(data.pagination.page - 1)}>
            Previous
          </Button>
          <Text as="span">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </Text>
          <Button
            disabled={data.pagination.page >= data.pagination.totalPages}
            onClick={() => gotoPage(data.pagination.page + 1)}
          >
            Next
          </Button>
        </InlineStack>
      )}
    </BlockStack>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "scheduled":
      return <Badge tone="info">Scheduled</Badge>;
    case "updated":
      return <Badge tone="attention">Updated</Badge>;
    case "completed":
      return <Badge tone="success">Completed</Badge>;
    case "canceled":
      return <Badge>Canceled</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
