import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigate } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  Badge,
  DataTable,
  Select,
  Divider,
  Modal,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { orderId } = params;

  if (!orderId) {
    throw new Error("Order ID is required");
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    throw new Error("Shop not found");
  }

  // Find the order link (booking)
  const orderLink = await prisma.orderLink.findFirst({
    where: {
      shopId: shop.id,
      shopifyOrderId: orderId,
      status: {
        in: ["scheduled", "updated"],
      },
    },
    include: {
      slot: {
        include: {
          location: true,
        },
      },
    },
  });

  if (!orderLink) {
    throw new Error("Order booking not found or already completed/canceled");
  }

  // Get available alternative slots
  const now = new Date();
  const twoWeeksFromNow = new Date(now);
  twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

  const availableSlots = await prisma.slot.findMany({
    where: {
      location: {
        shopId: shop.id,
        ...(orderLink.fulfillmentType === "delivery"
          ? { supportsDelivery: true }
          : { supportsPickup: true }),
      },
      date: {
        gte: now,
        lte: twoWeeksFromNow,
      },
      // Only show slots with available capacity
      AND: [
        {
          capacity: {
            gt: prisma.slot.fields.booked,
          },
        },
      ],
    },
    include: {
      location: true,
    },
    orderBy: [{ date: "asc" }, { timeStart: "asc" }],
    take: 50,
  });

  // Get event history for this order
  const eventHistory = await prisma.eventLog.findMany({
    where: {
      orderLinkId: orderLink.id,
    },
    orderBy: {
      timestamp: "desc",
    },
    take: 10,
  });

  return json({
    orderLink: {
      id: orderLink.id,
      shopifyOrderId: orderLink.shopifyOrderId,
      status: orderLink.status,
      fulfillmentType: orderLink.fulfillmentType,
      deliveryAddress: orderLink.deliveryAddress,
      deliveryPostcode: orderLink.deliveryPostcode,
      currentSlot: {
        id: orderLink.slot.id,
        date: orderLink.slot.date.toISOString(),
        timeStart: orderLink.slot.timeStart,
        timeEnd: orderLink.slot.timeEnd,
        capacity: orderLink.slot.capacity,
        booked: orderLink.slot.booked,
        location: {
          id: orderLink.slot.location.id,
          name: orderLink.slot.location.name,
          address: orderLink.slot.location.address,
        },
      },
    },
    availableSlots: availableSlots.map((slot) => ({
      id: slot.id,
      date: slot.date.toISOString(),
      timeStart: slot.timeStart,
      timeEnd: slot.timeEnd,
      capacity: slot.capacity,
      booked: slot.booked,
      available: slot.capacity - slot.booked,
      recommendationScore: slot.recommendationScore,
      location: {
        id: slot.location.id,
        name: slot.location.name,
        address: slot.location.address,
      },
    })),
    eventHistory: eventHistory.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      timestamp: event.timestamp.toISOString(),
      payload: event.payload,
    })),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { orderId } = params;
  const formData = await request.formData();
  const action = formData.get("action");

  if (!orderId) {
    return json({ success: false, error: "Order ID is required" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }

  try {
    if (action === "reschedule") {
      const newSlotId = formData.get("newSlotId") as string;
      const reason = formData.get("reason") as string;

      if (!newSlotId) {
        return json({ success: false, error: "New slot ID is required" }, { status: 400 });
      }

      // Find the current booking
      const orderLink = await prisma.orderLink.findFirst({
        where: {
          shopId: shop.id,
          shopifyOrderId: orderId,
          status: {
            in: ["scheduled", "updated"],
          },
        },
        include: {
          slot: true,
        },
      });

      if (!orderLink) {
        return json(
          { success: false, error: "Order booking not found" },
          { status: 404 }
        );
      }

      // Verify the new slot has capacity
      const newSlot = await prisma.slot.findUnique({
        where: { id: newSlotId },
        include: { location: true },
      });

      if (!newSlot) {
        return json({ success: false, error: "New slot not found" }, { status: 404 });
      }

      if (newSlot.booked >= newSlot.capacity) {
        return json(
          { success: false, error: "Selected slot is fully booked" },
          { status: 400 }
        );
      }

      const oldSlotId = orderLink.slotId;

      // Perform the reschedule in a transaction
      await prisma.$transaction(async (tx) => {
        // Decrement old slot's booked count
        await tx.slot.update({
          where: { id: oldSlotId },
          data: {
            booked: {
              decrement: 1,
            },
          },
        });

        // Increment new slot's booked count
        await tx.slot.update({
          where: { id: newSlotId },
          data: {
            booked: {
              increment: 1,
            },
          },
        });

        // Update the order link
        await tx.orderLink.update({
          where: { id: orderLink.id },
          data: {
            slotId: newSlotId,
            status: "updated",
          },
        });

        // Create event log entry
        await tx.eventLog.create({
          data: {
            orderLinkId: orderLink.id,
            eventType: "order.schedule_updated",
            timestamp: new Date(),
            payload: JSON.stringify({
              orderId,
              oldSlotId,
              newSlotId,
              oldSlot: {
                date: orderLink.slot.date,
                timeStart: orderLink.slot.timeStart,
                timeEnd: orderLink.slot.timeEnd,
              },
              newSlot: {
                date: newSlot.date,
                timeStart: newSlot.timeStart,
                timeEnd: newSlot.timeEnd,
                locationName: newSlot.location.name,
              },
              reason: reason || "Customer requested reschedule",
              rescheduledBy: "admin",
              rescheduledAt: new Date().toISOString(),
            }),
          },
        });
      });

      return json({
        success: true,
        message: "Order successfully rescheduled",
      });
    } else if (action === "cancel") {
      const reason = formData.get("reason") as string;

      // Find the current booking
      const orderLink = await prisma.orderLink.findFirst({
        where: {
          shopId: shop.id,
          shopifyOrderId: orderId,
          status: {
            in: ["scheduled", "updated"],
          },
        },
        include: {
          slot: true,
        },
      });

      if (!orderLink) {
        return json(
          { success: false, error: "Order booking not found" },
          { status: 404 }
        );
      }

      // Cancel the booking in a transaction
      await prisma.$transaction(async (tx) => {
        // Decrement slot's booked count
        await tx.slot.update({
          where: { id: orderLink.slotId },
          data: {
            booked: {
              decrement: 1,
            },
          },
        });

        // Update the order link status
        await tx.orderLink.update({
          where: { id: orderLink.id },
          data: {
            status: "canceled",
          },
        });

        // Create event log entry
        await tx.eventLog.create({
          data: {
            orderLinkId: orderLink.id,
            eventType: "order.schedule_canceled",
            timestamp: new Date(),
            payload: JSON.stringify({
              orderId,
              slotId: orderLink.slotId,
              slot: {
                date: orderLink.slot.date,
                timeStart: orderLink.slot.timeStart,
                timeEnd: orderLink.slot.timeEnd,
              },
              reason: reason || "Booking canceled",
              canceledBy: "admin",
              canceledAt: new Date().toISOString(),
            }),
          },
        });
      });

      return json({
        success: true,
        message: "Order booking canceled",
        redirect: "/app/orders",
      });
    }

    return json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Reschedule error:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred",
      },
      { status: 500 }
    );
  }
}

export default function RescheduleOrder() {
  const { orderLink, availableSlots, eventHistory } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();

  const [selectedSlotId, setSelectedSlotId] = useState<string>("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [showCancelModal, setShowCancelModal] = useState(false);

  // Redirect after successful action
  if (actionData?.success && actionData.redirect) {
    navigate(actionData.redirect);
  }

  const currentSlotDate = new Date(orderLink.currentSlot.date);

  // Prepare slot table data
  const slotRows = availableSlots.map((slot) => {
    const slotDate = new Date(slot.date);
    const isCurrentSlot = slot.id === orderLink.currentSlot.id;

    return [
      slotDate.toLocaleDateString(),
      `${slot.timeStart} - ${slot.timeEnd}`,
      slot.location.name,
      `${slot.available} / ${slot.capacity}`,
      slot.recommendationScore ? Math.round(slot.recommendationScore) : "N/A",
      isCurrentSlot ? (
        <Badge tone="info">Current</Badge>
      ) : (
        <Button
          size="slim"
          onClick={() => setSelectedSlotId(slot.id)}
          disabled={selectedSlotId === slot.id}
        >
          {selectedSlotId === slot.id ? "Selected" : "Select"}
        </Button>
      ),
    ];
  });

  return (
    <Page
      title={`Reschedule Order #${orderLink.shopifyOrderId}`}
      backAction={{ content: "Orders", url: "/app/orders" }}
    >
      <Layout>
        {/* Current Booking Info */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                Current Booking Details
              </Text>

              {actionData && !actionData.success && (
                <Banner tone="critical">
                  <Text as="p">{actionData.error || "An error occurred"}</Text>
                </Banner>
              )}

              {actionData?.success && (
                <Banner tone="success">
                  <Text as="p">{actionData.message}</Text>
                </Banner>
              )}

              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Order ID:
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {orderLink.shopifyOrderId}
                  </Text>
                </InlineStack>

                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Status:
                  </Text>
                  <Badge tone={orderLink.status === "scheduled" ? "success" : "info"}>
                    {orderLink.status}
                  </Badge>
                </InlineStack>

                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Fulfillment Type:
                  </Text>
                  <Badge>{orderLink.fulfillmentType}</Badge>
                </InlineStack>

                {orderLink.deliveryAddress && (
                  <InlineStack align="space-between">
                    <Text as="p" tone="subdued">
                      Delivery Address:
                    </Text>
                    <Text as="p">{orderLink.deliveryAddress}</Text>
                  </InlineStack>
                )}

                {orderLink.deliveryPostcode && (
                  <InlineStack align="space-between">
                    <Text as="p" tone="subdued">
                      Postcode:
                    </Text>
                    <Text as="p" fontWeight="semibold">
                      {orderLink.deliveryPostcode}
                    </Text>
                  </InlineStack>
                )}

                <Divider />

                <Text as="h3" variant="headingMd">
                  Current Slot
                </Text>

                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Date:
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {currentSlotDate.toLocaleDateString()}
                  </Text>
                </InlineStack>

                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Time:
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {orderLink.currentSlot.timeStart} - {orderLink.currentSlot.timeEnd}
                  </Text>
                </InlineStack>

                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Location:
                  </Text>
                  <Text as="p">{orderLink.currentSlot.location.name}</Text>
                </InlineStack>

                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Address:
                  </Text>
                  <Text as="p" variant="bodySm">
                    {orderLink.currentSlot.location.address}
                  </Text>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Available Alternative Slots */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                Available Alternative Slots
              </Text>
              <Text as="p" tone="subdued">
                Select a new slot for this order (showing next 14 days)
              </Text>

              {availableSlots.length === 0 ? (
                <Banner tone="warning">
                  <Text as="p">No alternative slots available in the next 14 days.</Text>
                </Banner>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                  headings={["Date", "Time", "Location", "Available", "Score", "Action"]}
                  rows={slotRows}
                />
              )}

              {selectedSlotId && (
                <Card background="bg-surface-secondary">
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      Reschedule to Selected Slot
                    </Text>
                    <TextField
                      label="Reason for Rescheduling (Optional)"
                      value={rescheduleReason}
                      onChange={setRescheduleReason}
                      placeholder="Customer requested different date"
                      multiline={3}
                      autoComplete="off"
                    />
                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        onClick={() => {
                          const formData = new FormData();
                          formData.append("action", "reschedule");
                          formData.append("newSlotId", selectedSlotId);
                          formData.append("reason", rescheduleReason);

                          // Submit form
                          const form = document.createElement("form");
                          form.method = "POST";
                          form.append(formData);
                          document.body.appendChild(form);
                          form.requestSubmit();
                        }}
                      >
                        Confirm Reschedule
                      </Button>
                      <Button onClick={() => setSelectedSlotId("")}>Cancel</Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Event History */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                Event History
              </Text>

              {eventHistory.length === 0 ? (
                <Text as="p" tone="subdued">
                  No events recorded
                </Text>
              ) : (
                <BlockStack gap="300">
                  {eventHistory.map((event) => {
                    const timestamp = new Date(event.timestamp);
                    let payload: any = {};
                    try {
                      payload = JSON.parse(event.payload || "{}");
                    } catch (e) {
                      // ignore
                    }

                    return (
                      <Card key={event.id} background="bg-surface-secondary">
                        <BlockStack gap="200">
                          <InlineStack align="space-between">
                            <Badge
                              tone={
                                event.eventType === "order.scheduled"
                                  ? "success"
                                  : event.eventType === "order.schedule_updated"
                                  ? "info"
                                  : "warning"
                              }
                            >
                              {event.eventType}
                            </Badge>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {timestamp.toLocaleString()}
                            </Text>
                          </InlineStack>
                          {payload.reason && (
                            <Text as="p" variant="bodySm">
                              Reason: {payload.reason}
                            </Text>
                          )}
                          {payload.oldSlot && payload.newSlot && (
                            <Text as="p" variant="bodySm">
                              Changed from{" "}
                              {new Date(payload.oldSlot.date).toLocaleDateString()}{" "}
                              {payload.oldSlot.timeStart} to{" "}
                              {new Date(payload.newSlot.date).toLocaleDateString()}{" "}
                              {payload.newSlot.timeStart}
                            </Text>
                          )}
                        </BlockStack>
                      </Card>
                    );
                  })}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Actions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                Other Actions
              </Text>
              <Button tone="critical" onClick={() => setShowCancelModal(true)}>
                Cancel This Booking
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Cancel Confirmation Modal */}
      <Modal
        open={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="Cancel Booking"
        primaryAction={{
          content: "Cancel Booking",
          destructive: true,
          onAction: () => {
            const formData = new FormData();
            formData.append("action", "cancel");
            formData.append("reason", cancelReason);

            const form = document.createElement("form");
            form.method = "POST";
            form.append(formData);
            document.body.appendChild(form);
            form.requestSubmit();

            setShowCancelModal(false);
          },
        }}
        secondaryActions={[
          {
            content: "Keep Booking",
            onAction: () => setShowCancelModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              Are you sure you want to cancel this booking? This will free up the slot for other
              customers.
            </Text>
            <TextField
              label="Reason for Cancellation (Optional)"
              value={cancelReason}
              onChange={setCancelReason}
              placeholder="Customer requested cancellation"
              multiline={3}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
