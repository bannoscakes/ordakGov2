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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const PAGE_SIZE = 20;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") || "all";
  const typeFilter = url.searchParams.get("type") || "all";
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));

  const where: {
    slot: { location: { shopId: string } };
    status?: string;
    fulfillmentType?: string;
  } = {
    slot: { location: { shopId: shop.id } },
  };
  if (statusFilter !== "all") where.status = statusFilter;
  if (typeFilter !== "all") where.fulfillmentType = typeFilter;

  const [orders, total] = await Promise.all([
    prisma.orderLink.findMany({
      where,
      include: {
        slot: {
          include: {
            location: { select: { id: true, name: true, city: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.orderLink.count({ where }),
  ]);

  return json({
    orders: orders.map((o) => ({
      id: o.id,
      shopifyOrderId: o.shopifyOrderId,
      shopifyOrderNumber: o.shopifyOrderNumber,
      status: o.status,
      fulfillmentType: o.fulfillmentType,
      wasRecommended: o.wasRecommended,
      createdAt: o.createdAt.toISOString(),
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
}

function statusBadge(status: string) {
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

export default function OrdersList() {
  const { orders, pagination, filters } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  function updateFilter(key: "status" | "type", value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete(key);
    else next.set(key, value);
    next.delete("page");
    setSearchParams(next);
  }

  function gotoPage(p: number) {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(p));
    setSearchParams(next);
  }

  if (orders.length === 0 && filters.status === "all" && filters.type === "all") {
    return (
      <Page title="Scheduled Orders">
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="No scheduled orders yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Orders with delivery/pickup scheduling will appear here once
                  customers start booking slots.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const rows = orders.map((o) => [
    o.shopifyOrderNumber || o.shopifyOrderId.slice(-8),
    formatDate(o.slot.date),
    `${o.slot.timeStart} – ${o.slot.timeEnd}`,
    o.slot.locationName + (o.slot.locationCity ? ` • ${o.slot.locationCity}` : ""),
    o.fulfillmentType === "delivery" ? "Delivery" : "Pickup",
    statusBadge(o.status),
    <Button key={o.id} onClick={() => navigate(`/app/orders/${o.shopifyOrderId}/reschedule`)}>
      Reschedule
    </Button>,
  ]);

  return (
    <Page title="Scheduled Orders">
      <Layout>
        <Layout.Section>
          <Card>
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
                  value={filters.status}
                  onChange={(v) => updateFilter("status", v)}
                />
                <Select
                  label="Type"
                  options={[
                    { label: "All", value: "all" },
                    { label: "Delivery", value: "delivery" },
                    { label: "Pickup", value: "pickup" },
                  ]}
                  value={filters.type}
                  onChange={(v) => updateFilter("type", v)}
                />
              </InlineStack>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "text", "text"]}
                headings={["Order", "Date", "Time", "Location", "Type", "Status", ""]}
                rows={rows}
              />
              {pagination.totalPages > 1 && (
                <InlineStack gap="200" align="end">
                  <Button
                    disabled={pagination.page <= 1}
                    onClick={() => gotoPage(pagination.page - 1)}
                  >
                    Previous
                  </Button>
                  <Text as="span">
                    Page {pagination.page} of {pagination.totalPages}
                  </Text>
                  <Button
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => gotoPage(pagination.page + 1)}
                  >
                    Next
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
