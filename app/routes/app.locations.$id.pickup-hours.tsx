import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useSearchParams } from "@remix-run/react";
import { Banner, BlockStack, Layout } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import {
  copyTemplatesBetweenDays,
  getTemplatesByDay,
  replaceTemplatesAndMaterialize,
} from "../services/slot-materializer.server";
import { parseCutoffOffsetMinutes } from "../services/slot-cutoff.server";
import { SlotsEditor } from "../components/SlotsEditor";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) throw new Response("Location id required", { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const location = await prisma.location.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true, supportsDelivery: true, supportsPickup: true },
  });
  if (!location) throw new Response("Location not found", { status: 404 });

  const pickupTemplatesByDay = await getTemplatesByDay({
    kind: "location",
    locationId: id,
    fulfillmentType: "pickup",
  });

  return json({
    supportsDelivery: location.supportsDelivery,
    pickupTemplatesByDay: pickupTemplatesByDay.map((day) =>
      day.map((t) => ({
        id: t.id,
        timeStart: t.timeStart,
        timeEnd: t.timeEnd,
        capacity: t.capacity,
        priceAdjustment: t.priceAdjustment.toString(),
        cutoffOffsetMinutes: t.cutoffOffsetMinutes,
        isActive: t.isActive,
      })),
    ),
  });
}

type ActionResult = { ok: true } | { ok: false; error: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) return json<ActionResult>({ ok: false, error: "Location id required" }, { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json<ActionResult>({ ok: false, error: "Shop not found" }, { status: 404 });

  const location = await prisma.location.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true },
  });
  if (!location) return json<ActionResult>({ ok: false, error: "Location not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "save-pickup-slots-day") {
      const dayOfWeek = parseInt((formData.get("dayOfWeek") as string | null) ?? "-1", 10);
      if (dayOfWeek < 0 || dayOfWeek > 6) {
        return json<ActionResult>({ ok: false, error: "Invalid day" }, { status: 400 });
      }
      const rowsJson = (formData.get("rows") as string | null) ?? "[]";
      let parsedRows: unknown;
      try {
        parsedRows = JSON.parse(rowsJson);
      } catch {
        return json<ActionResult>({ ok: false, error: "Malformed slot rows" }, { status: 400 });
      }
      if (!Array.isArray(parsedRows)) {
        return json<ActionResult>({ ok: false, error: "Slot rows must be an array" }, { status: 400 });
      }
      const rows: Array<{
        timeStart: string;
        timeEnd: string;
        capacity: number;
        priceAdjustment: number;
        cutoffOffsetMinutes: number | null;
        isActive: boolean;
      }> = [];
      for (const r of parsedRows) {
        if (typeof r !== "object" || r === null) continue;
        const row = r as Record<string, unknown>;
        const timeStart = String(row.timeStart ?? "");
        const timeEnd = String(row.timeEnd ?? "");
        const capacity = Number(row.capacity);
        const priceAdjustment = Number(row.priceAdjustment ?? 0);
        const cutoffOffsetMinutes = parseCutoffOffsetMinutes(row.cutoffOffsetMinutes);
        const isActive = row.isActive !== false;
        if (!/^\d{2}:\d{2}$/.test(timeStart) || !/^\d{2}:\d{2}$/.test(timeEnd)) {
          return json<ActionResult>(
            { ok: false, error: "All time fields must be in HH:MM format" },
            { status: 400 },
          );
        }
        if (timeStart >= timeEnd) {
          return json<ActionResult>(
            { ok: false, error: `Slot ${timeStart}–${timeEnd}: start must be before end` },
            { status: 400 },
          );
        }
        if (!Number.isFinite(capacity) || capacity < 1) {
          return json<ActionResult>(
            { ok: false, error: "Capacity must be at least 1" },
            { status: 400 },
          );
        }
        if (!Number.isFinite(priceAdjustment) || priceAdjustment < 0) {
          return json<ActionResult>(
            { ok: false, error: "Price adjustment must be 0 or higher" },
            { status: 400 },
          );
        }
        if (cutoffOffsetMinutes !== null && (cutoffOffsetMinutes < 0 || cutoffOffsetMinutes > 1440)) {
          return json<ActionResult>(
            { ok: false, error: "Cutoff must be between 0 and 24 hours" },
            { status: 400 },
          );
        }
        rows.push({ timeStart, timeEnd, capacity, priceAdjustment, cutoffOffsetMinutes, isActive });
      }

      await replaceTemplatesAndMaterialize({
        scope: { kind: "location", locationId: id, fulfillmentType: "pickup" },
        dayOfWeek,
        rows,
      });

      return redirect(`/app/locations/${id}/pickup-hours?day=${dayOfWeek}&saved=1`);
    }

    if (intent === "copy-pickup-slots-day") {
      const fromRaw = parseInt((formData.get("fromDayOfWeek") as string | null) ?? "-1", 10);
      const toRaw = (formData.get("toDaysOfWeek") as string | null) ?? "";
      const toDaysOfWeek = toRaw
        .split(",")
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6 && n !== fromRaw);
      if (fromRaw < 0 || fromRaw > 6 || toDaysOfWeek.length === 0) {
        return json<ActionResult>({ ok: false, error: "Invalid copy parameters" }, { status: 400 });
      }
      await copyTemplatesBetweenDays({
        scope: { kind: "location", locationId: id, fulfillmentType: "pickup" },
        fromDayOfWeek: fromRaw,
        toDaysOfWeek,
      });
      return redirect(`/app/locations/${id}/pickup-hours?day=${fromRaw}&copied=${toDaysOfWeek.length}`);
    }

    return json<ActionResult>({ ok: false, error: "Unknown intent" }, { status: 400 });
  } catch (error) {
    logger.error("Location pickup-hours action failed", error, { locationId: id, intent: String(intent) });
    return json<ActionResult>(
      { ok: false, error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

export default function LocationPickupHours() {
  const { pickupTemplatesByDay, supportsDelivery } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();

  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;
  const justSaved = searchParams.get("saved") === "1";
  const copiedTo = searchParams.get("copied");
  const fromWizard = searchParams.get("from") === "wizard";

  return (
    <BlockStack gap="400">
      {errorMessage && (
        <Layout>
          <Layout.Section>
            <Banner tone="critical">{errorMessage}</Banner>
          </Layout.Section>
        </Layout>
      )}
      {justSaved && !errorMessage && (
        <Layout>
          <Layout.Section>
            <Banner tone="success">Saved.</Banner>
          </Layout.Section>
        </Layout>
      )}
      {copiedTo && (
        <Layout>
          <Layout.Section>
            <Banner tone="success">
              Copied pickup hours to {copiedTo} other day{copiedTo === "1" ? "" : "s"}.
            </Banner>
          </Layout.Section>
        </Layout>
      )}
      {fromWizard && (
        <Layout>
          <Layout.Section>
            <Banner
              tone="info"
              title="Pickup hours — wizard step"
              action={
                supportsDelivery
                  ? { content: "Continue to delivery zones", url: "/app/setup?step=2" }
                  : { content: "Finish setup", url: "/app" }
              }
            >
              <p>
                Save at least one day below, then click{" "}
                <strong>
                  {supportsDelivery ? "Continue to delivery zones" : "Finish setup"}
                </strong>{" "}
                to keep going.
              </p>
            </Banner>
          </Layout.Section>
        </Layout>
      )}

      <SlotsEditor
        variant="pickup"
        templatesByDay={pickupTemplatesByDay}
        saveIntent="save-pickup-slots-day"
        copyIntent="copy-pickup-slots-day"
      />
    </BlockStack>
  );
}
