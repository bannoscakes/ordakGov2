/**
 * Calendar Overview Dashboard
 * Main dashboard showing scheduled orders in calendar view
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Badge,
  BlockStack,
  InlineStack,
  Text,
  Button,
  EmptyState,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay()); // Sunday
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  // Get today's orders
  const todayOrders = await prisma.orderLink.findMany({
    where: {
      slot: {
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
      status: {
        in: ["scheduled", "updated"],
      },
    },
    include: {
      slot: {
        include: {
          location: {
            select: {
              name: true,
              city: true,
            },
          },
        },
      },
    },
    orderBy: {
      slot: {
        timeStart: "asc",
      },
    },
  });

  // Get this week's orders
  const weekOrders = await prisma.orderLink.findMany({
    where: {
      slot: {
        date: {
          gte: weekStart,
          lt: weekEnd,
        },
      },
      status: {
        in: ["scheduled", "updated"],
      },
    },
    include: {
      slot: {
        include: {
          location: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  // Get slot utilization for next 7 days
  const next7Days = new Date(today);
  next7Days.setDate(today.getDate() + 7);

  const upcomingSlots = await prisma.slot.findMany({
    where: {
      date: {
        gte: today,
        lt: next7Days,
      },
      isActive: true,
    },
    include: {
      location: {
        select: {
          name: true,
        },
      },
      _count: {
        select: {
          orders: true,
        },
      },
    },
    orderBy: [
      { date: "asc" },
      { timeStart: "asc" },
    ],
  });

  // Calculate stats
  const todayDeliveries = todayOrders.filter(
    (o) => o.fulfillmentType === "delivery"
  ).length;
  const todayPickups = todayOrders.filter(
    (o) => o.fulfillmentType === "pickup"
  ).length;

  const weekDeliveries = weekOrders.filter(
    (o) => o.fulfillmentType === "delivery"
  ).length;
  const weekPickups = weekOrders.filter(
    (o) => o.fulfillmentType === "pickup"
  ).length;

  // Group today's orders by time slot
  const todayBySlot: Record<string, any[]> = {};
  todayOrders.forEach((order) => {
    const key = `${order.slot.timeStart}-${order.slot.timeEnd}`;
    if (!todayBySlot[key]) {
      todayBySlot[key] = [];
    }
    todayBySlot[key].push(order);
  });

  // Calculate utilization
  const totalCapacity = upcomingSlots.reduce((sum, slot) => sum + slot.capacity, 0);
  const totalBooked = upcomingSlots.reduce((sum, slot) => sum + slot.booked, 0);
  const utilizationPercent = totalCapacity > 0 ? Math.round((totalBooked / totalCapacity) * 100) : 0;

  return json({
    todayOrders,
    weekOrders,
    todayBySlot,
    upcomingSlots,
    stats: {
      todayTotal: todayOrders.length,
      todayDeliveries,
      todayPickups,
      weekTotal: weekOrders.length,
      weekDeliveries,
      weekPickups,
      utilizationPercent,
      totalCapacity,
      totalBooked,
    },
    today: today.toISOString(),
  });
}

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function Dashboard() {
  const { todayOrders, weekOrders, todayBySlot, upcomingSlots, stats, today } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const hasOrders = stats.todayTotal > 0 || stats.weekTotal > 0;

  return (
    <Page
      title="Calendar Overview"
      primaryAction={{
        content: "View All Orders",
        onAction: () => navigate("/app/orders"),
      }}
      secondaryActions={[
        {
          content: "Manage Locations",
          onAction: () => navigate("/app/locations"),
        },
      ]}
    >
      <Layout>
        {/* Stats Cards */}
        <Layout.Section>
          <InlineStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Today
                </Text>
                <Text as="p" variant="heading2xl">
                  {stats.todayTotal}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats.todayDeliveries} delivery, {stats.todayPickups} pickup
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  This Week
                </Text>
                <Text as="p" variant="heading2xl">
                  {stats.weekTotal}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats.weekDeliveries} delivery, {stats.weekPickups} pickup
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Slot Utilization
                </Text>
                <Text as="p" variant="heading2xl">
                  {stats.utilizationPercent}%
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats.totalBooked} / {stats.totalCapacity} slots booked
                </Text>
              </BlockStack>
            </Card>
          </InlineStack>
        </Layout.Section>

        {/* Today's Orders */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingLg">
                  Today's Schedule
                </Text>
                <Badge tone="info">{formatDate(new Date(today))}</Badge>
              </InlineStack>

              {stats.todayTotal === 0 ? (
                <EmptyState
                  heading="No orders scheduled for today"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Orders scheduled for today will appear here.</p>
                </EmptyState>
              ) : (
                <BlockStack gap="300">
                  {Object.entries(todayBySlot)
                    .sort()
                    .map(([timeSlot, orders]) => (
                      <Card key={timeSlot}>
                        <BlockStack gap="200">
                          <InlineStack align="space-between">
                            <Text as="h3" variant="headingMd">
                              {timeSlot}
                            </Text>
                            <Badge>{orders.length} order{orders.length !== 1 ? "s" : ""}</Badge>
                          </InlineStack>

                          <div
                            style={{
                              display: "grid",
                              gap: "8px",
                            }}
                          >
                            {orders.map((order) => (
                              <div
                                key={order.id}
                                style={{
                                  padding: "12px",
                                  background: "#f6f6f7",
                                  borderRadius: "8px",
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                }}
                              >
                                <div>
                                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                                    Order #{order.shopifyOrderNumber || order.shopifyOrderId.slice(-8)}
                                  </Text>
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {order.slot.location.name}
                                    {order.slot.location.city ? ` • ${order.slot.location.city}` : ""}
                                  </Text>
                                </div>
                                <InlineStack gap="200">
                                  {order.fulfillmentType === "delivery" ? (
                                    <Badge>🚚 Delivery</Badge>
                                  ) : (
                                    <Badge>📦 Pickup</Badge>
                                  )}
                                  {order.wasRecommended && (
                                    <Badge tone="success">⭐</Badge>
                                  )}
                                </InlineStack>
                              </div>
                            ))}
                          </div>
                        </BlockStack>
                      </Card>
                    ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Upcoming Slots */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                Next 7 Days - Slot Availability
              </Text>

              {upcomingSlots.length === 0 ? (
                <Banner tone="warning">
                  <p>
                    No active slots found for the next 7 days. Create slots to
                    start accepting bookings.
                  </p>
                </Banner>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  {upcomingSlots.map((slot) => {
                    const utilizationPercent = Math.round(
                      (slot.booked / slot.capacity) * 100
                    );
                    const isNearlyFull = utilizationPercent >= 80;
                    const isFull = slot.booked >= slot.capacity;

                    return (
                      <div
                        key={slot.id}
                        style={{
                          padding: "16px",
                          background: isFull
                            ? "#fef3f2"
                            : isNearlyFull
                            ? "#fffaeb"
                            : "#f6f6f7",
                          borderRadius: "8px",
                          border: isFull
                            ? "1px solid #f5c6cb"
                            : isNearlyFull
                            ? "1px solid #fde68a"
                            : "1px solid #e1e3e5",
                        }}
                      >
                        <InlineStack align="space-between">
                          <div>
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              {formatDate(slot.date)} • {slot.timeStart} - {slot.timeEnd}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {slot.location.name} •{" "}
                              {slot.fulfillmentType === "delivery"
                                ? "🚚 Delivery"
                                : "📦 Pickup"}
                            </Text>
                          </div>
                          <InlineStack gap="200" align="center">
                            <Text as="p" variant="bodyMd">
                              {slot.booked} / {slot.capacity}
                            </Text>
                            {isFull ? (
                              <Badge tone="critical">Full</Badge>
                            ) : isNearlyFull ? (
                              <Badge tone="attention">Nearly Full</Badge>
                            ) : (
                              <Badge tone="success">Available</Badge>
                            )}
                          </InlineStack>
                        </InlineStack>

                        {/* Progress bar */}
                        <div
                          style={{
                            marginTop: "12px",
                            height: "6px",
                            background: "#e1e3e5",
                            borderRadius: "3px",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${utilizationPercent}%`,
                              height: "100%",
                              background: isFull
                                ? "#d72c0d"
                                : isNearlyFull
                                ? "#f59e0b"
                                : "#008060",
                              transition: "width 0.3s ease",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Quick Actions */}
        {!hasOrders && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  Get Started
                </Text>
                <Text as="p" variant="bodyMd">
                  Set up your delivery and pickup scheduling to start accepting
                  bookings from customers.
                </Text>
                <InlineStack gap="200">
                  <Button onClick={() => navigate("/app/locations")}>
                    Add Locations
                  </Button>
                  <Button onClick={() => navigate("/app/zones")}>
                    Configure Zones
                  </Button>
                  <Button onClick={() => navigate("/app/rules")}>
                    Set Rules
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
