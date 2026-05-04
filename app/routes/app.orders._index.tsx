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
} from "@shopify/polaris";
import { ChevronLeftIcon, ChevronRightIcon } from "@shopify/polaris-icons";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

const PAGE_SIZE = 20;
type ViewMode = "calendar" | "list";

function isViewMode(v: string | null): v is ViewMode {
  return v === "calendar" || v === "list";
}

function parseMonth(raw: string | null): { year: number; month: number } {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split("-").map((s) => parseInt(s, 10));
    if (m >= 1 && m <= 12) return { year: y, month: m - 1 };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
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
      // Range covering the visible month grid (first Monday on/before the
      // 1st through the last Saturday/Sunday after the month's last day).
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);
      const gridStart = new Date(monthStart);
      const dow = gridStart.getDay(); // 0=Sun..6=Sat
      // Anchor to Monday: shift back so Sunday=6 days back, Monday=0.
      const back = (dow + 6) % 7;
      gridStart.setDate(gridStart.getDate() - back);
      const gridEnd = new Date(monthEnd);
      const endDow = gridEnd.getDay();
      const forward = (7 - ((endDow + 6) % 7) - 1) % 7;
      gridEnd.setDate(gridEnd.getDate() + forward);
      gridEnd.setHours(23, 59, 59, 999);

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
          },
          select: { date: true, capacity: true, booked: true },
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

      const capacityByDate: Record<string, { booked: number; capacity: number }> = {};
      for (const s of slotsForRange) {
        const key = formatLocalDate(new Date(s.date));
        if (!capacityByDate[key]) capacityByDate[key] = { booked: 0, capacity: 0 };
        capacityByDate[key].booked += s.booked;
        capacityByDate[key].capacity += s.capacity;
      }

      const days: string[] = [];
      const cursor = new Date(gridStart);
      while (cursor <= gridEnd) {
        days.push(formatLocalDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }

      return json({
        view: "calendar" as const,
        month: { year, monthIndex: month, label: monthStart.toLocaleDateString("en-AU", { month: "long", year: "numeric" }) },
        prevMonthParam: formatMonthParam(year, month - 1),
        nextMonthParam: formatMonthParam(year, month + 1),
        thisMonthParam: formatMonthParam(new Date().getFullYear(), new Date().getMonth()),
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

  function gotoMonth(monthParam: string) {
    const next = new URLSearchParams(searchParams);
    next.set("view", "calendar");
    next.set("month", monthParam);
    setSearchParams(next);
  }

  const ordersInOpenDate = openDate ? data.ordersByDate[openDate] ?? [] : [];

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <InlineStack gap="200" blockAlign="center">
          <Button icon={ChevronLeftIcon} onClick={() => gotoMonth(data.prevMonthParam)} accessibilityLabel="Previous month" />
          <Text as="h2" variant="headingMd">{data.month.label}</Text>
          <Button icon={ChevronRightIcon} onClick={() => gotoMonth(data.nextMonthParam)} accessibilityLabel="Next month" />
        </InlineStack>
        <InlineStack gap="200">
          <Button onClick={() => gotoMonth(data.thisMonthParam)}>Today</Button>
          <InlineStack gap="200" blockAlign="center">
            <LegendDot color="#2c5ecf" /><Text as="span" variant="bodySm">Delivery</Text>
            <LegendDot color="#1a8917" /><Text as="span" variant="bodySm">Pickup</Text>
          </InlineStack>
        </InlineStack>
      </InlineStack>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
        }}
      >
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
        {data.days.map((day) => {
          const inMonth = day >= data.monthStart && day <= data.monthEnd;
          const isToday = day === data.today;
          const orders = data.ordersByDate[day] ?? [];
          const cap = data.capacityByDate[day];
          const dayNum = parseInt(day.slice(8, 10), 10);
          return (
            <button
              key={day}
              type="button"
              onClick={() => setOpenDate(day)}
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: isToday ? 700 : 500, fontSize: 13 }}>{dayNum}</span>
                {cap && cap.capacity > 0 ? (
                  <span style={{ fontSize: 10, color: "var(--p-color-text-subdued, #6d7175)" }}>
                    {cap.booked}/{cap.capacity}
                  </span>
                ) : null}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                {orders.slice(0, 4).map((o) => (
                  <span
                    key={o.id}
                    style={{
                      fontSize: 11,
                      padding: "2px 6px",
                      borderRadius: 10,
                      color: "#fff",
                      background: o.fulfillmentType === "pickup" ? "#1a8917" : "#2c5ecf",
                    }}
                    title={`${o.timeStart}–${o.timeEnd} · ${o.locationName}`}
                  >
                    #{o.shopifyOrderNumber || o.shopifyOrderId.slice(-4)}
                  </span>
                ))}
                {orders.length > 4 ? (
                  <span style={{ fontSize: 11, color: "var(--p-color-text-subdued, #6d7175)" }}>
                    +{orders.length - 4} more
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

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
              {ordersInOpenDate.map((o) => (
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

function LegendDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: color }}
    />
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

  if (data.orders.length === 0 && data.filters.status === "all" && data.filters.type === "all") {
    return (
      <EmptyState
        heading="No scheduled orders yet"
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>Orders with delivery/pickup scheduling will appear here once customers start booking.</p>
      </EmptyState>
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
