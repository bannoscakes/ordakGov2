import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Banner,
  Button,
  Select,
  ChoiceList,
  InlineStack,
  Badge,
  EmptyState,
} from "@shopify/polaris";
import { useMemo, useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import {
  writeEventLogTx,
  dispatchEventLog,
  type DispatchableEventLog,
} from "../services/event-log.server";
import {
  addOrderMetafields,
  addOrderNote,
  addOrderTags,
  generateOrderNote,
  generateOrderTags,
  type SchedulingMetafields,
} from "../services/metafield.service";

const SLOT_LOOKAHEAD_DAYS = 30;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { orderId } = params;
  if (!orderId) throw new Response("Order id required", { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) throw new Response("Shop not found — reinstall the app", { status: 404 });

  const orderLink = await prisma.orderLink.findFirst({
    where: {
      shopifyOrderId: orderId,
      slot: { location: { shopId: shop.id } },
    },
    include: {
      slot: { include: { location: true, zone: true } },
    },
  });
  if (!orderLink) {
    throw new Response("Order is not scheduled with this app", { status: 404 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + SLOT_LOOKAHEAD_DAYS);

  // Same fulfillmentType only — switching pickup↔delivery requires a different
  // location (and usually different cart attrs); not in scope for v1 reschedule.
  const candidateSlots = await prisma.slot.findMany({
    where: {
      location: { shopId: shop.id },
      fulfillmentType: orderLink.fulfillmentType,
      isActive: true,
      date: { gte: today, lte: horizon },
    },
    include: { location: { select: { id: true, name: true } }, zone: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { timeStart: "asc" }],
  });

  const slots = candidateSlots
    .filter((s) => s.id === orderLink.slotId || s.booked < s.capacity)
    .map((s) => ({
      id: s.id,
      date: s.date.toISOString().slice(0, 10),
      timeStart: s.timeStart,
      timeEnd: s.timeEnd,
      capacity: s.capacity,
      booked: s.booked,
      isCurrent: s.id === orderLink.slotId,
      locationName: s.location.name,
      zoneName: s.zone?.name ?? null,
    }));

  return json({
    orderId,
    orderLink: {
      id: orderLink.id,
      fulfillmentType: orderLink.fulfillmentType,
      status: orderLink.status,
      currentSlot: {
        id: orderLink.slot.id,
        date: orderLink.slot.date.toISOString().slice(0, 10),
        timeStart: orderLink.slot.timeStart,
        timeEnd: orderLink.slot.timeEnd,
        locationName: orderLink.slot.location.name,
        zoneName: orderLink.slot.zone?.name ?? null,
      },
    },
    slots,
  });
}

type ActionResult = { ok: true } | { ok: false; error: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const { orderId } = params;
  if (!orderId) {
    return json<ActionResult>({ ok: false, error: "Order id required" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json<ActionResult>({ ok: false, error: "Shop not found" }, { status: 404 });
  }

  try {
    const formData = await request.formData();
    const newSlotId = ((formData.get("newSlotId") as string | null) || "").trim();
    const reason = ((formData.get("reason") as string | null) || "").trim();

    if (!newSlotId) {
      return json<ActionResult>({ ok: false, error: "Pick a slot to reschedule into" }, { status: 400 });
    }

    const orderLink = await prisma.orderLink.findFirst({
      where: {
        shopifyOrderId: orderId,
        slot: { location: { shopId: shop.id } },
      },
      include: { slot: { include: { location: true } } },
    });
    if (!orderLink) {
      return json<ActionResult>({ ok: false, error: "Order is not scheduled with this app" }, { status: 404 });
    }

    if (newSlotId === orderLink.slotId) {
      return json<ActionResult>({ ok: false, error: "That's already the current slot" }, { status: 400 });
    }

    const newSlot = await prisma.slot.findFirst({
      where: { id: newSlotId, location: { shopId: shop.id } },
      include: { location: true },
    });
    if (!newSlot) {
      return json<ActionResult>({ ok: false, error: "Slot not found for this shop" }, { status: 404 });
    }
    if (newSlot.fulfillmentType !== orderLink.fulfillmentType) {
      return json<ActionResult>(
        { ok: false, error: "Cannot switch between delivery and pickup via reschedule" },
        { status: 400 },
      );
    }
    if (!newSlot.isActive) {
      return json<ActionResult>({ ok: false, error: "Slot is not active" }, { status: 400 });
    }
    if (newSlot.booked >= newSlot.capacity) {
      return json<ActionResult>({ ok: false, error: "Slot is fully booked" }, { status: 400 });
    }

    const oldSlotSnapshot = {
      id: orderLink.slot.id,
      date: orderLink.slot.date.toISOString(),
      timeStart: orderLink.slot.timeStart,
      timeEnd: orderLink.slot.timeEnd,
      locationName: orderLink.slot.location.name,
    };

    let pendingEvent: DispatchableEventLog | null = null;

    await prisma.$transaction(async (tx) => {
      await tx.slot.update({
        where: { id: orderLink.slotId },
        data: { booked: { decrement: 1 } },
      });
      await tx.slot.update({
        where: { id: newSlot.id },
        data: { booked: { increment: 1 } },
      });
      await tx.orderLink.update({
        where: { id: orderLink.id },
        data: {
          slotId: newSlot.id,
          fulfillmentType: newSlot.fulfillmentType,
          status: "updated",
        },
      });
      pendingEvent = await writeEventLogTx({
        tx,
        data: {
          orderLinkId: orderLink.id,
          eventType: "order.schedule_updated",
          timestamp: new Date(),
          payload: JSON.stringify({
            orderId,
            oldSlotId: orderLink.slotId,
            newSlotId: newSlot.id,
            oldSlot: oldSlotSnapshot,
            newSlot: {
              id: newSlot.id,
              date: newSlot.date.toISOString(),
              timeStart: newSlot.timeStart,
              timeEnd: newSlot.timeEnd,
              locationName: newSlot.location.name,
            },
            reason: reason || "Admin reschedule",
            rescheduledBy: "admin",
            rescheduledAt: new Date().toISOString(),
          }),
        },
      });
    });

    if (pendingEvent) {
      await dispatchEventLog(shop.id, pendingEvent);
    }

    // Mirror to Shopify metafields/tags/note. Failures here are logged
    // but don't roll back the booking — the EventLog row is the source of
    // truth, and stale Shopify metadata is recoverable.
    try {
      const gid = `gid://shopify/Order/${orderId}`;
      const metafields: SchedulingMetafields = {
        slotId: newSlot.id,
        slotDate: newSlot.date.toISOString().split("T")[0],
        slotTimeStart: newSlot.timeStart,
        slotTimeEnd: newSlot.timeEnd,
        fulfillmentType: newSlot.fulfillmentType as "delivery" | "pickup",
        locationId: newSlot.location.id,
        locationName: newSlot.location.name,
        wasRecommended: orderLink.wasRecommended,
      };
      await addOrderMetafields(admin.graphql, gid, metafields);
      await addOrderTags(admin.graphql, gid, generateOrderTags(metafields));
      const note = `${generateOrderNote(metafields)}

--- Previous Scheduling (admin reschedule) ---
Date: ${new Date(oldSlotSnapshot.date).toLocaleDateString("en-AU", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}
Time: ${oldSlotSnapshot.timeStart} - ${oldSlotSnapshot.timeEnd}${reason ? `\nReason: ${reason}` : ""}`.trim();
      await addOrderNote(admin.graphql, gid, note);
    } catch (err) {
      logger.error("admin_reschedule_shopify_sync_failed", err, {
        shop: session.shop,
        orderId,
        newSlotId: newSlot.id,
      });
    }

    return redirect(`/app/orders/${orderId}/reschedule?rescheduled=1`);
  } catch (error) {
    logger.error("Admin reschedule failed", error, { shop: session.shop, orderId });
    return json<ActionResult>(
      { ok: false, error: "Reschedule failed. Please try again." },
      { status: 500 },
    );
  }
}

type LoaderSlot = ReturnType<typeof useLoaderData<typeof loader>>["slots"][number];

export default function Reschedule() {
  const { orderId, orderLink, slots } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state === "submitting";
  const justRescheduled = searchParams.get("rescheduled") === "1";

  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;

  const [selectedSlotId, setSelectedSlotId] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<string>("all");

  const dateOptions = useMemo(() => {
    const dates = Array.from(new Set(slots.map((s) => s.date)));
    return [
      { label: "All upcoming dates", value: "all" },
      ...dates.map((d) => ({ label: formatDate(d), value: d })),
    ];
  }, [slots]);

  const visibleSlots = useMemo(
    () => slots.filter((s) => dateFilter === "all" || s.date === dateFilter),
    [slots, dateFilter],
  );

  return (
    <Page
      title={`Reschedule order ${orderId}`}
      backAction={{ content: "Orders", url: "/app/orders" }}
    >
      <Layout>
        {justRescheduled && !errorMessage && (
          <Layout.Section>
            <Banner tone="success" title="Order rescheduled">
              <p>Shopify order metafields, tags, and the customer-facing note are being updated.</p>
            </Banner>
          </Layout.Section>
        )}
        {errorMessage && (
          <Layout.Section>
            <Banner tone="critical">{errorMessage}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">Current schedule</Text>
                <Badge tone={orderLink.fulfillmentType === "pickup" ? "success" : "info"}>
                  {orderLink.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}
                </Badge>
                <Badge>{orderLink.status}</Badge>
              </InlineStack>
              <Text as="p" variant="bodyMd">
                {formatDate(orderLink.currentSlot.date)} ·{" "}
                {orderLink.currentSlot.timeStart}–{orderLink.currentSlot.timeEnd}
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                {orderLink.currentSlot.locationName}
                {orderLink.currentSlot.zoneName ? ` · ${orderLink.currentSlot.zoneName}` : ""}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Pick a new slot</Text>
                <Select
                  label="Date"
                  labelHidden
                  options={dateOptions}
                  onChange={setDateFilter}
                  value={dateFilter}
                />
              </InlineStack>

              {visibleSlots.length === 0 ? (
                <EmptyState
                  heading="No available slots in the next 30 days"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Generate slots from a SlotTemplate or extend the date filter. Reschedule
                    looks 30 days ahead and only shows the same fulfillment type ({orderLink.fulfillmentType}).
                  </p>
                </EmptyState>
              ) : (
                <ChoiceList
                  title="Available slots"
                  titleHidden
                  selected={selectedSlotId ? [selectedSlotId] : []}
                  onChange={(values) => setSelectedSlotId(values[0] ?? "")}
                  choices={visibleSlots.map((s) => ({
                    label: formatSlotLabel(s),
                    value: s.id,
                    helpText: slotHelpText(s),
                    disabled: s.isCurrent,
                  }))}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <Form method="post">
              <BlockStack gap="300">
                <input type="hidden" name="newSlotId" value={selectedSlotId} />
                <Text as="h2" variant="headingMd">Reason (optional)</Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Recorded on the EventLog and the order note. Leave blank for a default note.
                </Text>
                <textarea
                  name="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. customer phoned to move to Saturday"
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: 6,
                    border: "1px solid #c9cccf",
                    fontFamily: "inherit",
                    fontSize: 14,
                    resize: "vertical",
                  }}
                />
                <InlineStack align="end">
                  <Button
                    variant="primary"
                    submit
                    loading={isSubmitting}
                    disabled={!selectedSlotId}
                  >
                    Reschedule
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatSlotLabel(s: LoaderSlot): string {
  const label = `${formatDate(s.date)} · ${s.timeStart}–${s.timeEnd}`;
  return s.isCurrent ? `${label} (current slot)` : label;
}

function slotHelpText(s: LoaderSlot): string {
  const remaining = Math.max(0, s.capacity - s.booked);
  const where = s.zoneName ? `${s.locationName} · ${s.zoneName}` : s.locationName;
  if (s.isCurrent) return `${where} · this is the current slot`;
  return `${where} · ${remaining} of ${s.capacity} remaining`;
}
