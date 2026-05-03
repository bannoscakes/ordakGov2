import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Banner,
  Button,
  TextField,
  Select,
  FormLayout,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

const SLOT_LOOKAHEAD_DAYS = 30;

type ActionResult = { ok: true } | { ok: false; error: string };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shopifyOrderId = params.orderId;
  if (!shopifyOrderId) {
    throw new Response("Missing order id", { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const orderLink = await prisma.orderLink.findFirst({
    where: {
      shopifyOrderId,
      slot: { location: { shopId: shop.id } },
    },
    include: {
      slot: { include: { location: true } },
    },
  });

  if (!orderLink) {
    throw new Response("Order not found in this shop", { status: 404 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + SLOT_LOOKAHEAD_DAYS);

  const availableSlots = await prisma.slot.findMany({
    where: {
      locationId: orderLink.slot.locationId,
      fulfillmentType: orderLink.fulfillmentType,
      isActive: true,
      date: { gte: today, lte: horizon },
    },
    orderBy: [{ date: "asc" }, { timeStart: "asc" }],
  });

  return json({
    order: {
      shopifyOrderId: orderLink.shopifyOrderId,
      shopifyOrderNumber: orderLink.shopifyOrderNumber,
      status: orderLink.status,
      fulfillmentType: orderLink.fulfillmentType,
      customerEmail: orderLink.customerEmail,
      customerPhone: orderLink.customerPhone,
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
          city: orderLink.slot.location.city,
        },
      },
    },
    availableSlots: availableSlots.map((s) => ({
      id: s.id,
      date: s.date.toISOString(),
      timeStart: s.timeStart,
      timeEnd: s.timeEnd,
      capacity: s.capacity,
      booked: s.booked,
      isFull: s.booked >= s.capacity,
    })),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shopifyOrderId = params.orderId;
  if (!shopifyOrderId) {
    return json<ActionResult>({ ok: false, error: "Missing order id" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json<ActionResult>({ ok: false, error: "Shop not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const newSlotId = ((formData.get("newSlotId") as string | null) || "").trim();
  const reason = ((formData.get("reason") as string | null) || "").trim();

  if (!newSlotId) {
    return json<ActionResult>({ ok: false, error: "Pick a new slot before saving" }, { status: 400 });
  }

  // Same transactional shape as /api/reschedule (customer path). Both routes write
  // an order.schedule_updated EventLog row with the same payload structure — keep
  // them in sync if you change either audit format.
  try {
    const orderLink = await prisma.orderLink.findFirst({
      where: {
        shopifyOrderId,
        slot: { location: { shopId: shop.id } },
        status: { in: ["scheduled", "updated"] },
      },
      include: { slot: true },
    });

    if (!orderLink) {
      return json<ActionResult>(
        { ok: false, error: "Order is completed, canceled, or doesn't belong to this shop" },
        { status: 404 },
      );
    }

    const newSlot = await prisma.slot.findUnique({
      where: { id: newSlotId },
      include: { location: true },
    });

    if (!newSlot) {
      return json<ActionResult>({ ok: false, error: "New slot not found" }, { status: 404 });
    }

    if (newSlot.location.shopId !== shop.id) {
      return json<ActionResult>(
        { ok: false, error: "Slot does not belong to this shop" },
        { status: 400 },
      );
    }

    if (newSlot.fulfillmentType !== orderLink.fulfillmentType) {
      return json<ActionResult>(
        {
          ok: false,
          error: `Slot is for ${newSlot.fulfillmentType}, but the order is ${orderLink.fulfillmentType}.`,
        },
        { status: 400 },
      );
    }

    if (newSlot.booked >= newSlot.capacity) {
      return json<ActionResult>({ ok: false, error: "Selected slot is fully booked" }, { status: 400 });
    }

    if (newSlot.id === orderLink.slotId) {
      return json<ActionResult>(
        { ok: false, error: "That's the current slot — pick a different one" },
        { status: 400 },
      );
    }

    const oldSlotId = orderLink.slotId;

    await prisma.$transaction(async (tx) => {
      await tx.slot.update({
        where: { id: oldSlotId },
        data: { booked: { decrement: 1 } },
      });
      await tx.slot.update({
        where: { id: newSlotId },
        data: { booked: { increment: 1 } },
      });
      await tx.orderLink.update({
        where: { id: orderLink.id },
        data: { slotId: newSlotId, status: "updated" },
      });
      await tx.eventLog.create({
        data: {
          orderLinkId: orderLink.id,
          eventType: "order.schedule_updated",
          timestamp: new Date(),
          payload: JSON.stringify({
            shopifyOrderId,
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
              locationAddress: newSlot.location.address,
            },
            reason: reason || "Admin reschedule",
            rescheduledBy: "admin",
            rescheduledAt: new Date().toISOString(),
          }),
        },
      });
    });

    return redirect("/app/orders");
  } catch (error) {
    logger.error("Admin reschedule failed", error, { shopifyOrderId, newSlotId });
    return json<ActionResult>(
      { ok: false, error: "Database error during reschedule. Try again or check logs." },
      { status: 500 },
    );
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminReschedule() {
  const { order, availableSlots } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [date, setDate] = useState("");
  const [slotId, setSlotId] = useState("");
  const [reason, setReason] = useState("");

  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;

  const datesAvailable = Array.from(
    new Set(availableSlots.map((s) => s.date.slice(0, 10))),
  ).sort();

  const slotsForDate = date
    ? availableSlots.filter((s) => s.date.startsWith(date))
    : [];

  const slotOptions = [
    { label: date ? "Pick a slot" : "Select a date first", value: "" },
    ...slotsForDate.map((s) => ({
      label: `${s.timeStart}–${s.timeEnd} · ${s.booked}/${s.capacity} booked${s.isFull ? " (FULL)" : ""}${s.id === order.currentSlot.id ? " — current" : ""}`,
      value: s.id,
      disabled: s.isFull || s.id === order.currentSlot.id,
    })),
  ];

  const onDateChange = (v: string) => {
    setDate(v);
    setSlotId("");
  };

  const orderLabel = order.shopifyOrderNumber
    ? `Order #${order.shopifyOrderNumber}`
    : `Order ${order.shopifyOrderId}`;

  const isLocked = order.status === "completed" || order.status === "canceled";

  return (
    <Page
      title={`Reschedule ${orderLabel}`}
      backAction={{ content: "Orders", url: "/app/orders" }}
    >
      <Layout>
        {errorMessage && (
          <Layout.Section>
            <Banner tone="critical">{errorMessage}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Current booking</Text>
              <InlineStack gap="400" wrap blockAlign="center">
                <Text as="p"><b>Date:</b> {formatDate(order.currentSlot.date)}</Text>
                <Text as="p"><b>Time:</b> {order.currentSlot.timeStart}–{order.currentSlot.timeEnd}</Text>
                <Text as="p">
                  <b>Location:</b> {order.currentSlot.location.name}
                  {order.currentSlot.location.city ? ` (${order.currentSlot.location.city})` : ""}
                </Text>
                <Badge tone={order.fulfillmentType === "delivery" ? "info" : undefined}>
                  {order.fulfillmentType === "delivery" ? "Delivery" : "Pickup"}
                </Badge>
                <Badge
                  tone={
                    order.status === "completed"
                      ? "success"
                      : order.status === "canceled"
                        ? "critical"
                        : "info"
                  }
                >
                  {order.status}
                </Badge>
              </InlineStack>
              {(order.customerEmail || order.customerPhone) && (
                <Text as="p" tone="subdued">
                  {order.customerEmail || ""}
                  {order.customerEmail && order.customerPhone ? " · " : ""}
                  {order.customerPhone || ""}
                </Text>
              )}
              {isLocked && (
                <Banner tone="warning">
                  This order is {order.status}. Rescheduling is locked — only orders with status
                  &quot;scheduled&quot; or &quot;updated&quot; can be moved.
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Pick a new slot</Text>
              <Text as="p" tone="subdued">
                Same location and same fulfillment type as the current booking. To switch to a
                different location, ask the customer to rebook.
              </Text>

              {datesAvailable.length === 0 ? (
                <Banner tone="warning">
                  No active slots in the next {SLOT_LOOKAHEAD_DAYS} days at{" "}
                  {order.currentSlot.location.name} for {order.fulfillmentType}. Add slots before
                  rescheduling.
                </Banner>
              ) : (
                <Form method="post">
                  <input type="hidden" name="newSlotId" value={slotId} />
                  <FormLayout>
                    <Select
                      label="New date"
                      options={[
                        { label: "Pick a date", value: "" },
                        ...datesAvailable.map((d) => ({
                          label: formatDate(new Date(d).toISOString()),
                          value: d,
                        })),
                      ]}
                      value={date}
                      onChange={onDateChange}
                      disabled={isLocked}
                      requiredIndicator
                    />

                    <Select
                      label="New slot"
                      options={slotOptions}
                      value={slotId}
                      onChange={setSlotId}
                      disabled={isLocked || !date || slotsForDate.length === 0}
                      requiredIndicator
                    />

                    <TextField
                      label="Reason for reschedule (optional)"
                      name="reason"
                      value={reason}
                      onChange={setReason}
                      placeholder="e.g., Customer phoned in to move pickup forward"
                      multiline={3}
                      autoComplete="off"
                      helpText="Recorded in the audit log; not visible to the customer"
                      disabled={isLocked}
                    />

                    <InlineStack align="end" gap="200">
                      <Button onClick={() => navigate("/app/orders")}>Cancel</Button>
                      <Button
                        variant="primary"
                        submit
                        loading={isLoading}
                        disabled={isLocked || !slotId}
                      >
                        Save reschedule
                      </Button>
                    </InlineStack>
                  </FormLayout>
                </Form>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
