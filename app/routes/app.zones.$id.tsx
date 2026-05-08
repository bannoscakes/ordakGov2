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
  Select,
  Checkbox,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Modal,
  Text,
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
import { SlotsEditor } from "../components/SlotsEditor";

type Section = "setup" | "pricing" | "slots";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "setup", label: "Zone setup" },
  { id: "pricing", label: "Pricing" },
  { id: "slots", label: "Time slots & limits" },
];

function isSection(v: string | null): v is Section {
  return v === "setup" || v === "pricing" || v === "slots";
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) throw new Response("Zone id required", { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const zone = await prisma.zone.findFirst({
    where: { id, shopId: shop.id },
    include: {
      location: { select: { id: true, name: true, latitude: true, longitude: true, supportsDelivery: true } },
      _count: { select: { slots: true } },
    },
  });
  if (!zone) throw new Response("Zone not found", { status: 404 });

  // Only delivery templates live on a zone — pickup slots are per-location.
  const templatesByDay = await getTemplatesByDay({
    kind: "zone",
    zoneId: id,
    fulfillmentType: "delivery",
  });

  const url = new URL(request.url);
  const sectionParam = url.searchParams.get("section");
  const section: Section = isSection(sectionParam) ? sectionParam : "setup";

  return json({
    zone: {
      id: zone.id,
      name: zone.name,
      type: zone.type,
      postcodes: zone.postcodes,
      excludePostcodes: zone.excludePostcodes,
      radiusKm: zone.radiusKm,
      basePrice: zone.basePrice.toString(),
      isActive: zone.isActive,
      priority: zone.priority,
      location: zone.location,
      slotCount: zone._count.slots,
    },
    templatesByDay: templatesByDay.map((day) =>
      day.map((t) => ({
        id: t.id,
        timeStart: t.timeStart,
        timeEnd: t.timeEnd,
        capacity: t.capacity,
        priceAdjustment: t.priceAdjustment.toString(),
        isActive: t.isActive,
      })),
    ),
    section,
  });
}

type ActionResult =
  | { ok: true; message?: string; materialized?: { created: number; deleted: number; preserved: number } }
  | { ok: false; error: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) return json<ActionResult>({ ok: false, error: "Zone id required" }, { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json<ActionResult>({ ok: false, error: "Shop not found" }, { status: 404 });

  const zone = await prisma.zone.findFirst({
    where: { id, shopId: shop.id },
    include: { location: true },
  });
  if (!zone) return json<ActionResult>({ ok: false, error: "Zone not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "delete") {
      await prisma.zone.delete({ where: { id } });
      return redirect(`/app/locations/${zone.locationId}?section=zones`);
    }

    if (intent === "save-setup") {
      const name = ((formData.get("name") as string | null) || "").trim();
      const type = (formData.get("type") as string | null) ?? "";
      if (!name || !type) {
        return json<ActionResult>({ ok: false, error: "Name and type are required" }, { status: 400 });
      }

      let postcodes: string[] = [];
      let radiusKm: number | null = null;

      if (type === "postcode_list") {
        const raw = (formData.get("postcodes") as string | null) ?? "";
        postcodes = raw.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
        if (postcodes.length === 0) {
          return json<ActionResult>({ ok: false, error: "Enter at least one postcode" }, { status: 400 });
        }
      } else if (type === "postcode_range") {
        const start = ((formData.get("rangeStart") as string | null) || "").trim();
        const end = ((formData.get("rangeEnd") as string | null) || "").trim();
        if (!start || !end) {
          return json<ActionResult>(
            { ok: false, error: "Enter both start and end postcodes" },
            { status: 400 },
          );
        }
        postcodes = [start, end];
      } else if (type === "radius") {
        const raw = (formData.get("radiusKm") as string | null) ?? "";
        const parsed = parseFloat(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return json<ActionResult>(
            { ok: false, error: "Radius must be a positive number" },
            { status: 400 },
          );
        }
        if (zone.location.latitude == null || zone.location.longitude == null) {
          return json<ActionResult>(
            {
              ok: false,
              error:
                "This zone's location has no latitude/longitude. Edit the location and set coordinates first.",
            },
            { status: 400 },
          );
        }
        radiusKm = parsed;
      } else {
        return json<ActionResult>({ ok: false, error: "Invalid zone type" }, { status: 400 });
      }

      await prisma.zone.update({
        where: { id },
        data: {
          name,
          type,
          postcodes,
          radiusKm,
          isActive: formData.get("isActive") === "true",
          priority: parseInt((formData.get("priority") as string | null) ?? "0", 10) || 0,
        },
      });
      return redirect(`/app/zones/${id}?section=setup&saved=1`);
    }

    if (intent === "save-pricing") {
      const basePriceRaw = ((formData.get("basePrice") as string | null) || "0").trim();
      const basePrice = parseFloat(basePriceRaw);
      if (!Number.isFinite(basePrice) || basePrice < 0) {
        return json<ActionResult>(
          { ok: false, error: "Base price must be a non-negative number" },
          { status: 400 },
        );
      }
      const excludeRaw = (formData.get("excludePostcodes") as string | null) ?? "";
      const excludePostcodes = excludeRaw
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      await prisma.zone.update({
        where: { id },
        data: { basePrice, excludePostcodes },
      });
      return redirect(`/app/zones/${id}?section=pricing&saved=1`);
    }

    if (intent === "save-slots-day") {
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
        isActive: boolean;
      }> = [];
      for (const r of parsedRows) {
        if (typeof r !== "object" || r === null) continue;
        const row = r as Record<string, unknown>;
        const timeStart = String(row.timeStart ?? "");
        const timeEnd = String(row.timeEnd ?? "");
        const capacity = Number(row.capacity);
        const priceAdjustment = Number(row.priceAdjustment);
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
        rows.push({ timeStart, timeEnd, capacity, priceAdjustment, isActive });
      }

      const result = await replaceTemplatesAndMaterialize({
        scope: { kind: "zone", zoneId: id, fulfillmentType: "delivery" },
        dayOfWeek,
        rows,
      });

      return redirect(
        `/app/zones/${id}?section=slots&day=${dayOfWeek}&saved=1&created=${result.slotsCreated}&deleted=${result.slotsDeleted}&preserved=${result.slotsPreservedDueToBookings}`,
      );
    }

    if (intent === "copy-slots-day") {
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
        scope: { kind: "zone", zoneId: id, fulfillmentType: "delivery" },
        fromDayOfWeek: fromRaw,
        toDaysOfWeek,
      });
      return redirect(`/app/zones/${id}?section=slots&day=${fromRaw}&copied=${toDaysOfWeek.length}`);
    }

    return json<ActionResult>({ ok: false, error: "Unknown intent" }, { status: 400 });
  } catch (error) {
    logger.error("Per-zone admin action failed", error, { zoneId: id, intent: String(intent) });
    return json<ActionResult>(
      { ok: false, error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

export default function ZoneAdmin() {
  const { zone, templatesByDay, section } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const [searchParams] = useSearchParams();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;
  const justSaved = searchParams.get("saved") === "1";
  const copiedTo = searchParams.get("copied");
  const fromWizard = searchParams.get("from") === "wizard";

  const goToSection = (s: Section) => {
    navigate(`/app/zones/${zone.id}?section=${s}`, { replace: true });
  };

  const onDelete = () => {
    const fd = new FormData();
    fd.append("intent", "delete");
    submit(fd, { method: "post" });
    setDeleteOpen(false);
  };

  return (
    <Page
      title={zone.name}
      subtitle={`Zone of ${zone.location.name}`}
      backAction={{ content: "Back to location", url: `/app/locations/${zone.location.id}?section=zones` }}
      secondaryActions={[
        { content: "Delete zone", destructive: true, onAction: () => setDeleteOpen(true) },
      ]}
    >
      <Layout>
        {fromWizard && (
          <Layout.Section>
            <Banner
              tone="info"
              title="Zone created — finish setup"
              action={{ content: "Back to dashboard", url: "/app" }}
            >
              <p>
                Set the base delivery price under <strong>Pricing</strong> and configure
                time slots under <strong>Time slots & limits</strong>. The dashboard
                tracks your remaining setup steps.
              </p>
            </Banner>
          </Layout.Section>
        )}
        {errorMessage && (
          <Layout.Section>
            <Banner tone="critical">{errorMessage}</Banner>
          </Layout.Section>
        )}
        {justSaved && !errorMessage && (
          <Layout.Section>
            <Banner tone="success">Saved.</Banner>
          </Layout.Section>
        )}
        {copiedTo && (
          <Layout.Section>
            <Banner tone="success">Copied slots to {copiedTo} other day{copiedTo === "1" ? "" : "s"}.</Banner>
          </Layout.Section>
        )}

        <Layout.Section variant="oneThird">
          <Card padding="0">
            <BlockStack gap="0">
              {SECTIONS.map((s) => (
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
          {section === "setup" && <SetupSection zone={zone} />}
          {section === "pricing" && <PricingSection zone={zone} />}
          {section === "slots" && <SlotsSection templatesByDay={templatesByDay} />}
        </Layout.Section>
      </Layout>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete zone"
        primaryAction={{ content: "Delete", destructive: true, onAction: onDelete }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">Delete &quot;{zone.name}&quot;?</Text>
            {zone.slotCount > 0 && (
              <Banner tone="warning">
                This zone has {zone.slotCount} materialized slot(s). Deleting the zone removes them
                — bookings on those slots will be orphaned.
              </Banner>
            )}
            <Text as="p" tone="critical">This action cannot be undone.</Text>
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

type ZoneData = ReturnType<typeof useLoaderData<typeof loader>>["zone"];

function SetupSection({ zone }: { zone: ZoneData }) {
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [name, setName] = useState(zone.name);
  const [type, setType] = useState(zone.type);
  const [isActive, setIsActive] = useState(zone.isActive);
  const [priority, setPriority] = useState(String(zone.priority));

  const [postcodes, setPostcodes] = useState(
    zone.type === "postcode_list" ? zone.postcodes.join(", ") : "",
  );
  const [rangeStart, setRangeStart] = useState(
    zone.type === "postcode_range" && zone.postcodes.length >= 1 ? zone.postcodes[0] : "",
  );
  const [rangeEnd, setRangeEnd] = useState(
    zone.type === "postcode_range" && zone.postcodes.length >= 2 ? zone.postcodes[1] : "",
  );
  const [radiusKm, setRadiusKm] = useState(zone.radiusKm ? String(zone.radiusKm) : "");

  const radiusNeedsCoords =
    type === "radius" && (zone.location.latitude == null || zone.location.longitude == null);

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="save-setup" />
      <input type="hidden" name="isActive" value={isActive.toString()} />
      <FormLayout>
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Zone setup</Text>
            <TextField
              label="Zone name"
              name="name"
              value={name}
              onChange={setName}
              autoComplete="off"
              requiredIndicator
            />
            <Select
              label="Match type"
              name="type"
              options={[
                { label: "Postcode list", value: "postcode_list" },
                { label: "Postcode range", value: "postcode_range" },
                { label: "Radius from location", value: "radius" },
              ]}
              value={type}
              onChange={setType}
              requiredIndicator
            />
            <TextField
              label="Priority"
              name="priority"
              value={priority}
              onChange={setPriority}
              type="number"
              min={0}
              helpText="Higher numbers match first when a postcode is in multiple zones"
              autoComplete="off"
            />
          </BlockStack>
        </Card>

        {type === "postcode_list" && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Postcodes</Text>
              <TextField
                label="Postcodes"
                name="postcodes"
                value={postcodes}
                onChange={setPostcodes}
                placeholder="e.g., 2000, 2001, 2010, 2060"
                multiline={3}
                autoComplete="off"
                helpText="Separate with commas"
                requiredIndicator
              />
            </BlockStack>
          </Card>
        )}

        {type === "postcode_range" && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Postcode range</Text>
              <InlineStack gap="400">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Start"
                    name="rangeStart"
                    value={rangeStart}
                    onChange={setRangeStart}
                    autoComplete="off"
                    requiredIndicator
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="End"
                    name="rangeEnd"
                    value={rangeEnd}
                    onChange={setRangeEnd}
                    autoComplete="off"
                    requiredIndicator
                  />
                </div>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {type === "radius" && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Radius</Text>
              {radiusNeedsCoords && (
                <Banner tone="warning">
                  This zone&apos;s location ({zone.location.name}) has no latitude/longitude.
                  Edit the location and set coordinates first.
                </Banner>
              )}
              <TextField
                label="Radius (km)"
                name="radiusKm"
                value={radiusKm}
                onChange={setRadiusKm}
                type="number"
                step={0.1}
                min={0}
                autoComplete="off"
                requiredIndicator
              />
            </BlockStack>
          </Card>
        )}

        <Card>
          <Checkbox
            label="Active"
            checked={isActive}
            onChange={setIsActive}
            helpText="Inactive zones are hidden from customers and Carrier Service quotes"
          />
        </Card>

        <InlineStack align="end">
          <Button variant="primary" submit loading={isLoading} disabled={isLoading}>Save</Button>
        </InlineStack>
      </FormLayout>
    </Form>
  );
}

// ---------- Section: Pricing ----------

function PricingSection({ zone }: { zone: ZoneData }) {
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [basePrice, setBasePrice] = useState(zone.basePrice);
  const [excludePostcodes, setExcludePostcodes] = useState(zone.excludePostcodes.join(", "));

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="save-pricing" />
      <FormLayout>
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Delivery pricing</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Base delivery charge for orders matched to this zone. Time slots can add a
              per-slot premium on top of this (configured in Time slots & limits).
            </Text>
            <TextField
              label="Base delivery price (AUD)"
              name="basePrice"
              value={basePrice}
              onChange={setBasePrice}
              type="number"
              step={0.01}
              min={0}
              prefix="$"
              autoComplete="off"
              requiredIndicator
              helpText="Customer pays this + the selected slot's price adjustment"
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">Exclude postcodes (optional)</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Postcodes inside this zone&apos;s coverage that you DON&apos;T want to deliver to.
              Useful for &quot;all of inner Sydney except these specific suburbs&quot;.
            </Text>
            <TextField
              label="Exclude postcodes"
              name="excludePostcodes"
              value={excludePostcodes}
              onChange={setExcludePostcodes}
              placeholder="e.g., 2099, 2100"
              multiline={2}
              autoComplete="off"
              helpText="Separate with commas. Leave blank for none."
            />
          </BlockStack>
        </Card>

        <InlineStack align="end">
          <Button variant="primary" submit loading={isLoading} disabled={isLoading}>Save</Button>
        </InlineStack>
      </FormLayout>
    </Form>
  );
}

// ---------- Section: Time slots & limits ----------

function SlotsSection({
  templatesByDay,
}: {
  templatesByDay: ReturnType<typeof useLoaderData<typeof loader>>["templatesByDay"];
}) {
  return (
    <SlotsEditor
      variant="delivery"
      templatesByDay={templatesByDay}
      saveIntent="save-slots-day"
      copyIntent="copy-slots-day"
    />
  );
}
