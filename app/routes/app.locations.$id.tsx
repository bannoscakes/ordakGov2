import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Checkbox,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Modal,
  Text,
  Badge,
  DataTable,
  EmptyState,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import {
  copyTemplatesBetweenDays,
  getTemplatesByDay,
  replaceTemplatesAndMaterialize,
} from "../services/slot-materializer.server";
import { isValidIanaTimezone, parseCutoffOffsetMinutes } from "../services/slot-cutoff.server";
import { SlotsEditor } from "../components/SlotsEditor";

type Section = "setup" | "fulfillment" | "pickup-hours" | "prep-time" | "block-dates" | "zones";

// "Pickup hours" is appended at runtime when supportsPickup is true.
const BASE_SECTIONS: { id: Section; label: string }[] = [
  { id: "setup", label: "Location setup" },
  { id: "fulfillment", label: "Fulfillment type" },
  { id: "prep-time", label: "Prep time & availability" },
  { id: "block-dates", label: "Block dates & times" },
  { id: "zones", label: "Zones" },
];

function isSection(v: string | null): v is Section {
  return (
    v === "setup" ||
    v === "fulfillment" ||
    v === "pickup-hours" ||
    v === "prep-time" ||
    v === "block-dates" ||
    v === "zones"
  );
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const { id } = params;
  if (!id) {
    throw new Response("Location id is required", { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const location = await prisma.location.findFirst({
    where: { id, shopId: shop.id },
    include: {
      _count: { select: { slots: true, zones: true } },
      zones: {
        select: {
          id: true,
          name: true,
          type: true,
          postcodes: true,
          basePrice: true,
          isActive: true,
          priority: true,
          _count: { select: { slots: true } },
        },
        orderBy: { priority: "asc" },
      },
    },
  });

  if (!location) {
    throw new Response("Location not found", { status: 404 });
  }

  // Per-shop rules (today these aren't location-scoped — placeholder sections will
  // surface them with a link out to the global Rules admin).
  const rules = await prisma.rule.findMany({
    where: { shopId: shop.id, type: { in: ["lead_time", "blackout"] } },
    orderBy: { createdAt: "desc" },
  });

  // Pickup templates only matter when the location actually supports pickup.
  // We still load them when supportsPickup is false so toggling the checkbox
  // back on doesn't lose templates the merchant configured previously.
  const pickupTemplatesByDay = await getTemplatesByDay({
    kind: "location",
    locationId: id,
    fulfillmentType: "pickup",
  });
  const pickupTemplateCount = pickupTemplatesByDay.reduce((n, day) => n + day.length, 0);

  const url = new URL(request.url);
  const sectionParam = url.searchParams.get("section");
  const section: Section = isSection(sectionParam) ? sectionParam : "setup";

  return json({
    location: {
      ...location,
      basePrice: undefined, // Location has no basePrice; zones do
      zones: location.zones.map((z) => ({
        ...z,
        basePrice: z.basePrice.toString(), // Decimal → string for client
      })),
    },
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      cutoffTime: r.cutoffTime,
      leadTimeHours: r.leadTimeHours,
      leadTimeDays: r.leadTimeDays,
      blackoutDates: r.blackoutDates.map((d) => d.toISOString()),
      isActive: r.isActive,
    })),
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
    pickupTemplateCount,
    section,
  });
}

type ActionResult = { ok: true } | { ok: false; error: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) {
    return json<ActionResult>({ ok: false, error: "Location id is required" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json<ActionResult>({ ok: false, error: "Shop not found" }, { status: 404 });
  }

  const location = await prisma.location.findFirst({
    where: { id, shopId: shop.id },
    include: { _count: { select: { slots: true, zones: true } } },
  });
  if (!location) {
    return json<ActionResult>({ ok: false, error: "Location not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "delete") {
      if (location._count.slots > 0 || location._count.zones > 0) {
        return json<ActionResult>(
          {
            ok: false,
            error: `Cannot delete: ${location._count.slots} slot(s) and ${location._count.zones} zone(s) attached. Remove them first.`,
          },
          { status: 400 },
        );
      }
      await prisma.location.delete({ where: { id } });
      return redirect("/app/locations");
    }

    if (intent === "save-setup") {
      const name = ((formData.get("name") as string | null) || "").trim();
      const address = ((formData.get("address") as string | null) || "").trim();
      if (!name || !address) {
        return json<ActionResult>({ ok: false, error: "Name and address are required" }, { status: 400 });
      }
      const timezone = ((formData.get("timezone") as string | null) || "UTC").trim() || "UTC";
      if (!isValidIanaTimezone(timezone)) {
        return json<ActionResult>(
          { ok: false, error: `Invalid timezone "${timezone}". Use an IANA name like "Australia/Sydney" or "UTC".` },
          { status: 400 },
        );
      }
      const latRaw = formData.get("latitude") as string | null;
      const lngRaw = formData.get("longitude") as string | null;
      const latitude = latRaw ? parseFloat(latRaw) : null;
      const longitude = lngRaw ? parseFloat(lngRaw) : null;
      await prisma.location.update({
        where: { id },
        data: {
          name,
          address,
          city: ((formData.get("city") as string | null) || "").trim() || null,
          province: ((formData.get("province") as string | null) || "").trim() || null,
          country: ((formData.get("country") as string | null) || "").trim() || null,
          postalCode: ((formData.get("postalCode") as string | null) || "").trim() || null,
          latitude: latitude !== null && Number.isFinite(latitude) ? latitude : null,
          longitude: longitude !== null && Number.isFinite(longitude) ? longitude : null,
          phone: ((formData.get("phone") as string | null) || "").trim() || null,
          email: ((formData.get("email") as string | null) || "").trim() || null,
          timezone,
          isActive: formData.get("isActive") === "true",
        },
      });
      return redirect(`/app/locations/${id}?section=setup&saved=1`);
    }

    if (intent === "save-fulfillment") {
      await prisma.location.update({
        where: { id },
        data: {
          supportsDelivery: formData.get("supportsDelivery") === "true",
          supportsPickup: formData.get("supportsPickup") === "true",
        },
      });
      return redirect(`/app/locations/${id}?section=fulfillment&saved=1`);
    }

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

      return redirect(`/app/locations/${id}?section=pickup-hours&day=${dayOfWeek}&saved=1`);
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
      return redirect(`/app/locations/${id}?section=pickup-hours&day=${fromRaw}&copied=${toDaysOfWeek.length}`);
    }

    return json<ActionResult>({ ok: false, error: "Unknown intent" }, { status: 400 });
  } catch (error) {
    logger.error("Per-location admin action failed", error, { locationId: id, intent: String(intent) });
    return json<ActionResult>(
      { ok: false, error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

export default function LocationAdmin() {
  const { location, rules, pickupTemplatesByDay, pickupTemplateCount, section } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const [searchParams] = useSearchParams();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;
  const justSaved = searchParams.get("saved") === "1";
  const copiedTo = searchParams.get("copied");
  const fromWizard = searchParams.get("from") === "wizard";

  const goToSection = (s: Section) => {
    navigate(`/app/locations/${location.id}?section=${s}`, { replace: true });
  };

  const onDelete = () => {
    const fd = new FormData();
    fd.append("intent", "delete");
    submit(fd, { method: "post" });
    setDeleteModalOpen(false);
  };

  const hasUsage = location._count.slots > 0 || location._count.zones > 0;

  // The "Pickup hours" sidebar entry only appears when this location actually
  // does pickup. Hiding it when supportsPickup=false keeps delivery-only
  // locations free of irrelevant config noise.
  const sections = location.supportsPickup
    ? [
        ...BASE_SECTIONS.slice(0, 2),
        { id: "pickup-hours" as Section, label: "Pickup hours" },
        ...BASE_SECTIONS.slice(2),
      ]
    : BASE_SECTIONS;

  // Misconfiguration we want the merchant to see no matter which tab they're on:
  // they checked Supports pickup but never told us when pickup is available, so
  // the cart-block has nothing to offer customers.
  const pickupNeedsHours = location.supportsPickup && pickupTemplateCount === 0;

  return (
    <Page
      title={location.name}
      backAction={{ content: "Locations", url: "/app/locations" }}
      secondaryActions={[
        {
          content: "Delete location",
          destructive: true,
          onAction: () => setDeleteModalOpen(true),
        },
      ]}
    >
      <Layout>
        {errorMessage && (
          <Layout.Section>
            <Banner tone="critical">{errorMessage}</Banner>
          </Layout.Section>
        )}
        {justSaved && !errorMessage && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => navigate(`/app/locations/${location.id}?section=${section}`, { replace: true })}>
              Saved.
            </Banner>
          </Layout.Section>
        )}
        {copiedTo && (
          <Layout.Section>
            <Banner tone="success">Copied pickup hours to {copiedTo} other day{copiedTo === "1" ? "" : "s"}.</Banner>
          </Layout.Section>
        )}
        {pickupNeedsHours && section !== "pickup-hours" && (
          <Layout.Section>
            <Banner
              tone="warning"
              title="Pickup is enabled but has no hours configured"
              action={{
                content: "Configure pickup hours",
                onAction: () => goToSection("pickup-hours"),
              }}
            >
              <p>
                You enabled Store Pickup for this location but haven&apos;t set when customers
                can collect. Until pickup hours are configured, the cart-block will show
                &quot;Pickup not available on this date&quot; for every date.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section variant="oneThird">
          <Card padding="0">
            <BlockStack gap="0">
              {sections.map((s) => (
                <SidebarItem
                  key={s.id}
                  label={s.label}
                  active={section === s.id}
                  onClick={() => goToSection(s.id)}
                />
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          {section === "setup" && <SetupSection location={location} hasUsage={hasUsage} />}
          {section === "fulfillment" && <FulfillmentSection location={location} />}
          {section === "pickup-hours" && location.supportsPickup && (
            <PickupHoursSection
              pickupTemplatesByDay={pickupTemplatesByDay}
              fromWizard={fromWizard}
              supportsDelivery={location.supportsDelivery}
            />
          )}
          {section === "pickup-hours" && !location.supportsPickup && (
            <Banner tone="info">
              Store Pickup is turned off for this location. Enable it under
              &quot;Fulfillment type&quot; first, then come back here to set hours.
            </Banner>
          )}
          {section === "prep-time" && <PrepTimeSection rules={rules.filter((r) => r.type === "lead_time")} />}
          {section === "block-dates" && <BlockDatesSection rules={rules.filter((r) => r.type === "blackout")} />}
          {section === "zones" && <ZonesSection location={location} />}
        </Layout.Section>
      </Layout>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete location"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: onDelete,
          disabled: hasUsage,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">Delete &quot;{location.name}&quot;?</Text>
            {hasUsage ? (
              <Banner tone="critical">
                {location._count.slots} slot(s) and {location._count.zones} zone(s) are attached.
                Remove them first.
              </Banner>
            ) : (
              <Text as="p" tone="critical">This action cannot be undone.</Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function SidebarItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        padding: "12px 16px",
        textAlign: "left",
        background: active ? "var(--p-color-bg-surface-selected, #f1f1f1)" : "transparent",
        border: "none",
        borderLeft: active ? "3px solid var(--p-color-bg-fill-brand, #1a1a1a)" : "3px solid transparent",
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
        fontSize: "14px",
      }}
    >
      {label}
    </button>
  );
}

// ---------- Section: Setup ----------

type LocationData = ReturnType<typeof useLoaderData<typeof loader>>["location"];

function SetupSection({ location, hasUsage }: { location: LocationData; hasUsage: boolean }) {
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address);
  const [city, setCity] = useState(location.city || "");
  const [province, setProvince] = useState(location.province || "");
  const [country, setCountry] = useState(location.country || "");
  const [postalCode, setPostalCode] = useState(location.postalCode || "");
  const [latitude, setLatitude] = useState(location.latitude?.toString() || "");
  const [longitude, setLongitude] = useState(location.longitude?.toString() || "");
  const [phone, setPhone] = useState(location.phone || "");
  const [email, setEmail] = useState(location.email || "");
  const [timezone, setTimezone] = useState(location.timezone || "UTC");
  const [isActive, setIsActive] = useState(location.isActive);

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="save-setup" />
      <input type="hidden" name="isActive" value={isActive.toString()} />
      <FormLayout>
        {hasUsage && (
          <Banner tone="info">
            This location has {location._count.slots} slot(s) and {location._count.zones} zone(s).
            Removing it requires removing those first.
          </Banner>
        )}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Address</Text>
            <TextField
              label="Location name"
              name="name"
              value={name}
              onChange={setName}
              autoComplete="off"
              requiredIndicator
            />
            <TextField
              label="Address"
              name="address"
              value={address}
              onChange={setAddress}
              autoComplete="off"
              requiredIndicator
            />
            <InlineStack gap="400">
              <div style={{ flex: 1 }}>
                <TextField label="City" name="city" value={city} onChange={setCity} autoComplete="off" />
              </div>
              <div style={{ flex: 1 }}>
                <TextField label="Province/state" name="province" value={province} onChange={setProvince} autoComplete="off" />
              </div>
            </InlineStack>
            <InlineStack gap="400">
              <div style={{ flex: 1 }}>
                <TextField label="Country" name="country" value={country} onChange={setCountry} autoComplete="off" />
              </div>
              <div style={{ flex: 1 }}>
                <TextField label="Postcode" name="postalCode" value={postalCode} onChange={setPostalCode} autoComplete="off" />
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">Coordinates (optional)</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Used for radius zones and distance-based matching. Find them on Google Maps.
            </Text>
            <InlineStack gap="400">
              <div style={{ flex: 1 }}>
                <TextField label="Latitude" name="latitude" value={latitude} onChange={setLatitude} type="number" step={0.000001} autoComplete="off" />
              </div>
              <div style={{ flex: 1 }}>
                <TextField label="Longitude" name="longitude" value={longitude} onChange={setLongitude} type="number" step={0.000001} autoComplete="off" />
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack gap="400">
              <div style={{ flex: 1 }}>
                <TextField label="Phone" name="phone" value={phone} onChange={setPhone} type="tel" autoComplete="off" />
              </div>
              <div style={{ flex: 1 }}>
                <TextField label="Email" name="email" value={email} onChange={setEmail} type="email" autoComplete="off" />
              </div>
            </InlineStack>
            <TextField
              label="Timezone"
              name="timezone"
              value={timezone}
              onChange={setTimezone}
              helpText="e.g., Australia/Sydney"
              autoComplete="off"
            />
          </BlockStack>
        </Card>

        <Card>
          <Checkbox
            label="Active"
            checked={isActive}
            onChange={setIsActive}
            helpText="Inactive locations are hidden from customers"
          />
        </Card>

        <InlineStack align="end" gap="200">
          <Button variant="primary" submit loading={isLoading} disabled={isLoading}>Save</Button>
        </InlineStack>
      </FormLayout>
    </Form>
  );
}

// ---------- Section: Fulfillment ----------

function FulfillmentSection({ location }: { location: LocationData }) {
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [supportsDelivery, setSupportsDelivery] = useState(location.supportsDelivery);
  const [supportsPickup, setSupportsPickup] = useState(location.supportsPickup);

  // Heads-up shown only when the merchant *just* enabled pickup in this form
  // (it wasn't enabled when the page loaded). Hides after they save — at that
  // point the page-level "needs pickup hours" banner takes over.
  const showPickupNudge = supportsPickup && !location.supportsPickup;

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="save-fulfillment" />
      <input type="hidden" name="supportsDelivery" value={supportsDelivery.toString()} />
      <input type="hidden" name="supportsPickup" value={supportsPickup.toString()} />
      <FormLayout>
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Fulfillment methods</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Choose which fulfillment methods this location offers. The cart-block shows
              the matching toggles to customers.
            </Text>
            <Checkbox
              label="Local Delivery"
              checked={supportsDelivery}
              onChange={setSupportsDelivery}
              helpText="Orders dispatched from this location to a customer's address. Delivery hours are configured per zone."
            />
            <Checkbox
              label="Store Pickup"
              checked={supportsPickup}
              onChange={setSupportsPickup}
              helpText="Customers collect orders from this location. Pickup hours are configured here on the location, not on a zone."
            />
            {showPickupNudge && (
              <Banner tone="info">
                After saving, you&apos;ll see a new <strong>Pickup hours</strong> tab in the
                sidebar. Set the days and hours customers can collect, otherwise the cart-block
                will show &quot;Pickup not available on this date&quot;.
              </Banner>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">Minimum order value</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Per-method minimum order value (e.g. $30 minimum for delivery).
              Coming in a follow-up step — schema needs additional fields.
            </Text>
            <Banner tone="info">
              Not yet wired. For now, set minimums via Shopify checkout rules or use the
              cart-block&apos;s minimum-cart-value setting in the theme editor.
            </Banner>
          </BlockStack>
        </Card>

        <InlineStack align="end" gap="200">
          <Button variant="primary" submit loading={isLoading} disabled={isLoading}>Save</Button>
        </InlineStack>
      </FormLayout>
    </Form>
  );
}

// ---------- Section: Pickup hours ----------

function PickupHoursSection({
  pickupTemplatesByDay,
  fromWizard,
  supportsDelivery,
}: {
  pickupTemplatesByDay: ReturnType<typeof useLoaderData<typeof loader>>["pickupTemplatesByDay"];
  fromWizard: boolean;
  supportsDelivery: boolean;
}) {
  return (
    <BlockStack gap="400">
      {fromWizard && (
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
            Save at least one day below, then click <strong>
              {supportsDelivery ? "Continue to delivery zones" : "Finish setup"}
            </strong> to keep going.
          </p>
        </Banner>
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

// ---------- Section: Prep time ----------

function PrepTimeSection({ rules }: { rules: ReturnType<typeof useLoaderData<typeof loader>>["rules"] }) {
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Prep time & availability</Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Minimum lead time required between order placement and fulfillment (e.g. &quot;orders
            placed today are eligible for tomorrow at the earliest&quot;).
          </Text>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">Current rules</Text>
          {rules.length === 0 ? (
            <Banner tone="info">
              No lead-time rules configured yet. Add one in the global Rules admin.
            </Banner>
          ) : (
            <BlockStack gap="200">
              {rules.map((r) => (
                <InlineStack key={r.id} gap="300" blockAlign="center">
                  <Badge tone={r.isActive ? "success" : undefined}>{r.isActive ? "Active" : "Inactive"}</Badge>
                  <Text as="p"><b>{r.name}</b></Text>
                  <Text as="p" tone="subdued">
                    {r.leadTimeDays ? `${r.leadTimeDays}d ` : ""}
                    {r.leadTimeHours ? `${r.leadTimeHours}h` : ""}
                  </Text>
                </InlineStack>
              ))}
            </BlockStack>
          )}
          <Banner tone="info">
            Rules are currently shop-wide, not per-location. Per-location prep time will be added
            in a follow-up step.
          </Banner>
          <InlineStack>
            <Button url="/app/rules">Manage rules globally</Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

// ---------- Section: Block dates ----------

function BlockDatesSection({ rules }: { rules: ReturnType<typeof useLoaderData<typeof loader>>["rules"] }) {
  const blackoutCount = rules.reduce((n, r) => n + (r.blackoutDates?.length ?? 0), 0);
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Block dates & times</Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Calendar dates when this location can&apos;t fulfill orders (holidays, maintenance).
          </Text>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">Current blackout rules</Text>
          {rules.length === 0 ? (
            <Banner tone="info">
              No blackout rules configured yet. Add one in the global Rules admin.
            </Banner>
          ) : (
            <BlockStack gap="200">
              {rules.map((r) => (
                <InlineStack key={r.id} gap="300" blockAlign="center" wrap>
                  <Badge tone={r.isActive ? "success" : undefined}>{r.isActive ? "Active" : "Inactive"}</Badge>
                  <Text as="p"><b>{r.name}</b></Text>
                  <Text as="p" tone="subdued">
                    {r.blackoutDates.length} date{r.blackoutDates.length === 1 ? "" : "s"}
                  </Text>
                </InlineStack>
              ))}
              <Text as="p" tone="subdued" variant="bodySm">
                Total blocked: {blackoutCount}
              </Text>
            </BlockStack>
          )}
          <Banner tone="info">
            Rules are currently shop-wide, not per-location. Per-location blackouts (and time-of-day
            blocks) will be added in a follow-up step.
          </Banner>
          <InlineStack>
            <Button url="/app/rules">Manage rules globally</Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

// ---------- Section: Zones ----------

function ZonesSection({ location }: { location: LocationData }) {
  const navigate = useNavigate();

  const rows = location.zones.map((z) => [
    z.name,
    typeForLabel(z.type),
    `${z.postcodes.length} postcode${z.postcodes.length === 1 ? "" : "s"}`,
    `$${formatBasePrice(z.basePrice)} AUD`,
    `${z._count.slots} slot${z._count.slots === 1 ? "" : "s"}`,
    <Badge key={z.id} tone={z.isActive ? "success" : "critical"}>{z.isActive ? "Active" : "Inactive"}</Badge>,
    <Button key={z.id} size="slim" onClick={() => navigate(`/app/zones/${z.id}`)}>Edit</Button>,
  ]);

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">Zones</Text>
            <Button
              variant="primary"
              onClick={() => navigate(`/app/zones/new?locationId=${location.id}`)}
            >
              Add zone
            </Button>
          </InlineStack>
          <Text as="p" tone="subdued" variant="bodySm">
            Zones define which postcodes (or radius) this location can deliver to, and the base
            delivery price for that area. Each zone has its own time slots configured separately.
          </Text>
        </BlockStack>
      </Card>

      {location.zones.length === 0 ? (
        <Card>
          <EmptyState
            heading="No zones yet"
            action={{
              content: "Add your first zone",
              onAction: () => navigate(`/app/zones/new?locationId=${location.id}`),
            }}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              Add a zone with the postcodes this location delivers to and a base delivery price.
            </p>
          </EmptyState>
        </Card>
      ) : (
        <Card padding="0">
          <DataTable
            columnContentTypes={["text", "text", "text", "numeric", "text", "text", "text"]}
            headings={["Name", "Match", "Coverage", "Base price", "Slots", "Status", ""]}
            rows={rows}
          />
        </Card>
      )}
    </BlockStack>
  );
}

function typeForLabel(t: string): string {
  if (t === "postcode_list") return "Postcode list";
  if (t === "postcode_range") return "Postcode range";
  if (t === "radius") return "Radius (km)";
  return t;
}

function formatBasePrice(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toFixed(2);
}
