import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  DataTable,
  Button,
  TextField,
  Select,
  Pagination,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const page = parseInt(url.searchParams.get("page") || "1");
  const perPage = 20;
  const status = url.searchParams.get("status") || "all";
  const search = url.searchParams.get("search") || "";

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    throw new Error("Shop not found");
  }

  // Build where clause
  const whereClause: any = {
    shopId: shop.id,
  };

  if (status !== "all") {
    whereClause.status = status;
  }

  if (search) {
    whereClause.shopifyOrderId = {
      contains: search,
    };
  }

  // Get total count
  const totalOrders = await prisma.orderLink.count({
    where: whereClause,
  });

  // Get paginated orders
  const orderLinks = await prisma.orderLink.findMany({
    where: whereClause,
    include: {
      slot: {
        include: {
          location: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    skip: (page - 1) * perPage,
    take: perPage,
  });

  const totalPages = Math.ceil(totalOrders / perPage);

  return json({
    orderLinks: orderLinks.map((ol) => ({
      id: ol.id,
      shopifyOrderId: ol.shopifyOrderId,
      status: ol.status,
      fulfillmentType: ol.fulfillmentType,
      deliveryAddress: ol.deliveryAddress,
      deliveryPostcode: ol.deliveryPostcode,
      createdAt: ol.createdAt.toISOString(),
      slot: {
        id: ol.slot.id,
        date: ol.slot.date.toISOString(),
        timeStart: ol.slot.timeStart,
        timeEnd: ol.slot.timeEnd,
        location: {
          id: ol.slot.location.id,
          name: ol.slot.location.name,
          address: ol.slot.location.address,
        },
      },
    })),
    pagination: {
      currentPage: page,
      totalPages,
      totalOrders,
      perPage,
    },
    filters: {
      status,
      search,
    },
  });
}

export default function OrdersList() {
  const { orderLinks, pagination, filters } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchValue, setSearchValue] = useState(filters.search);
  const [statusFilter, setStatusFilter] = useState(filters.status);

  const handleFilterChange = () => {
    const params = new URLSearchParams();
    if (searchValue) params.set("search", searchValue);
    if (statusFilter !== "all") params.set("status", statusFilter);
    params.set("page", "1");
    setSearchParams(params);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(newPage));
    setSearchParams(params);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "scheduled":
        return <Badge tone="success">Scheduled</Badge>;
      case "updated":
        return <Badge tone="info">Updated</Badge>;
      case "canceled":
        return <Badge tone="critical">Canceled</Badge>;
      case "completed":
        return <Badge>Completed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const orderRows = orderLinks.map((order) => {
    const slotDate = new Date(order.slot.date);
    const createdDate = new Date(order.createdAt);

    return [
      order.shopifyOrderId,
      getStatusBadge(order.status),
      <Badge>{order.fulfillmentType}</Badge>,
      order.deliveryPostcode || "N/A",
      slotDate.toLocaleDateString(),
      `${order.slot.timeStart} - ${order.slot.timeEnd}`,
      order.slot.location.name,
      createdDate.toLocaleDateString(),
      <InlineStack gap="200">
        <Button
          size="slim"
          onClick={() => navigate(`/app/orders/${order.shopifyOrderId}/reschedule`)}
          disabled={order.status === "canceled" || order.status === "completed"}
        >
          Reschedule
        </Button>
      </InlineStack>,
    ];
  });

  return (
    <Page
      title="Orders"
      subtitle={`${pagination.totalOrders} booking(s)`}
      primaryAction={{
        content: "Refresh",
        onAction: () => window.location.reload(),
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Filters
              </Text>
              <InlineStack gap="400">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Search by Order ID"
                    value={searchValue}
                    onChange={setSearchValue}
                    placeholder="Search orders..."
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setSearchValue("")}
                  />
                </div>
                <Select
                  label="Status"
                  options={[
                    { label: "All Statuses", value: "all" },
                    { label: "Scheduled", value: "scheduled" },
                    { label: "Updated", value: "updated" },
                    { label: "Canceled", value: "canceled" },
                    { label: "Completed", value: "completed" },
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <Button onClick={handleFilterChange}>Apply Filters</Button>
                </div>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {orderLinks.length === 0 ? (
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    No orders found
                  </Text>
                  <Text as="p" tone="subdued">
                    {filters.search || filters.status !== "all"
                      ? "Try adjusting your filters"
                      : "Orders will appear here once customers book delivery slots"}
                  </Text>
                </BlockStack>
              ) : (
                <>
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
                      "text",
                    ]}
                    headings={[
                      "Order ID",
                      "Status",
                      "Type",
                      "Postcode",
                      "Slot Date",
                      "Slot Time",
                      "Location",
                      "Booked On",
                      "Actions",
                    ]}
                    rows={orderRows}
                  />

                  {pagination.totalPages > 1 && (
                    <InlineStack align="center">
                      <Pagination
                        hasPrevious={pagination.currentPage > 1}
                        onPrevious={() => handlePageChange(pagination.currentPage - 1)}
                        hasNext={pagination.currentPage < pagination.totalPages}
                        onNext={() => handlePageChange(pagination.currentPage + 1)}
                        label={`Page ${pagination.currentPage} of ${pagination.totalPages}`}
                      />
                    </InlineStack>
                  )}
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Quick Stats
              </Text>
              <InlineStack gap="400">
                <Card>
                  <BlockStack gap="200">
                    <Text as="p" variant="headingXl">
                      {pagination.totalOrders}
                    </Text>
                    <Text as="p" tone="subdued">
                      Total Bookings
                    </Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="200">
                    <Text as="p" variant="headingXl">
                      {orderLinks.filter((o) => o.status === "scheduled").length}
                    </Text>
                    <Text as="p" tone="subdued">
                      Scheduled (This Page)
                    </Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="200">
                    <Text as="p" variant="headingXl">
                      {orderLinks.filter((o) => o.status === "updated").length}
                    </Text>
                    <Text as="p" tone="subdued">
                      Updated (This Page)
                    </Text>
                  </BlockStack>
                </Card>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
