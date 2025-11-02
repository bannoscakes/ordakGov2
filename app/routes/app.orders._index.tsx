/**
 * Orders Management Page
 * View and manage orders with scheduling information
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
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
import { useState } from "react";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") || "all";
  const typeFilter = url.searchParams.get("type") || "all";

  // Build where clause
  const where: any = {};

  if (statusFilter !== "all") {
    where.status = statusFilter;
  }

  if (typeFilter !== "all") {
    where.fulfillmentType = typeFilter;
  }

  // Get orders with scheduling
  const orders = await prisma.orderLink.findMany({
    where,
    include: {
      slot: {
        include: {
          location: {
            select: {
              id: true,
              name: true,
              city: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50, // Limit for performance
  });

  const stats = {
    total: orders.length,
    scheduled: orders.filter((o) => o.status === "scheduled").length,
    updated: orders.filter((o) => o.status === "updated").length,
    completed: orders.filter((o) => o.status === "completed").length,
    canceled: orders.filter((o) => o.status === "canceled").length,
    delivery: orders.filter((o) => o.fulfillmentType === "delivery").length,
    pickup: orders.filter((o) => o.fulfillmentType === "pickup").length,
    recommended: orders.filter((o) => o.wasRecommended).length,
  };

  return json({ orders, stats, statusFilter, typeFilter });
}

function getStatusBadge(status: string) {
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

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function OrdersList() {
  const { orders, stats, statusFilter, typeFilter } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const [selectedStatus, setSelectedStatus] = useState(statusFilter);
  const [selectedType, setSelectedType] = useState(typeFilter);

  const handleFilterChange = (status: string, type: string) => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (type !== "all") params.set("type", type);
    navigate(`/app/orders?${params.toString()}`);
  };

  if (orders.length === 0 && statusFilter === "all" && typeFilter === "all") {
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

  const rows = orders.map((order) => [
    order.shopifyOrderNumber || order.shopifyOrderId.slice(-8),
    formatDate(order.slot.date),
    `${order.slot.timeStart} - ${order.slot.timeEnd}`,
    order.slot.location.name,
    order.fulfillmentType === "delivery" ? (
      <Badge>🚚 Delivery</Badge>
    ) : (
      <Badge>📦 Pickup</Badge>
    ),
    getStatusBadge(order.status),
    order.wasRecommended ? <Badge tone="success">⭐ Recommended</Badge> : "",
    <Button
      onClick={() =>
        window.open(
          `https://${order.shopifyOrderId}/orders/${order.shopifyOrderId}`,
          "_blank"
        )
      }
      variant="plain"
    >
      View
    </Button>,
  ]);

  return (
    <Page title="Scheduled Orders">
      <Layout>
        {/* Stats Cards */}
        <Layout.Section>
          <InlineStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Total Orders
                </Text>
                <Text as="p" variant="heading2xl">
                  {stats.total}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats.scheduled} scheduled
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  By Type
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd">
                    🚚 Delivery: {stats.delivery}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    📦 Pickup: {stats.pickup}
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Recommendations
                </Text>
                <Text as="p" variant="heading2xl">
                  {stats.recommended}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats.total > 0
                    ? Math.round((stats.recommended / stats.total) * 100)
                    : 0}
                  % adoption
                </Text>
              </BlockStack>
            </Card>
          </InlineStack>
        </Layout.Section>

        {/* Filters */}
        <Layout.Section>
          <Card>
            <InlineStack gap="400">
              <div style={{ minWidth: "200px" }}>
                <Select
                  label="Status"
                  options={[
                    { label: "All Statuses", value: "all" },
                    { label: "Scheduled", value: "scheduled" },
                    { label: "Updated", value: "updated" },
                    { label: "Completed", value: "completed" },
                    { label: "Canceled", value: "canceled" },
                  ]}
                  value={selectedStatus}
                  onChange={(value) => {
                    setSelectedStatus(value);
                    handleFilterChange(value, selectedType);
                  }}
                />
              </div>
              <div style={{ minWidth: "200px" }}>
                <Select
                  label="Fulfillment Type"
                  options={[
                    { label: "All Types", value: "all" },
                    { label: "Delivery", value: "delivery" },
                    { label: "Pickup", value: "pickup" },
                  ]}
                  value={selectedType}
                  onChange={(value) => {
                    setSelectedType(value);
                    handleFilterChange(selectedStatus, value);
                  }}
                />
              </div>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Orders Table */}
        <Layout.Section>
          {orders.length === 0 ? (
            <Card>
              <EmptyState heading="No orders match your filters">
                <p>Try adjusting your filter criteria.</p>
              </EmptyState>
            </Card>
          ) : (
            <Card padding="0">
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                ]}
                headings={[
                  "Order",
                  "Date",
                  "Time",
                  "Location",
                  "Type",
                  "Status",
                  "Recommended",
                  "Actions",
                ]}
                rows={rows}
              />
            </Card>
          )}
        </Layout.Section>

        {/* Help Card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                About Scheduled Orders
              </Text>
              <Text as="p" variant="bodyMd">
                This page shows all orders that have been linked to delivery or
                pickup slots. Each order is automatically tagged and has
                metafields added for easy filtering and automation.
              </Text>
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd">
                  • <strong>Scheduled:</strong> Initial slot booking
                </Text>
                <Text as="p" variant="bodyMd">
                  • <strong>Updated:</strong> Schedule changed by customer or merchant
                </Text>
                <Text as="p" variant="bodyMd">
                  • <strong>Completed:</strong> Order fulfilled successfully
                </Text>
                <Text as="p" variant="bodyMd">
                  • <strong>Canceled:</strong> Order or schedule canceled
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
