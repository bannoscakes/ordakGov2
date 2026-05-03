import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
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
  ProgressBar,
  Text,
  Badge,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = {
  1: "Add a location",
  2: "Define a service zone",
  3: "Add a scheduling rule (optional)",
};

function pickStep(searchParam: string | null, hasLocations: boolean, hasZones: boolean): Step {
  const parsed = searchParam ? Number(searchParam) : NaN;
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  if (!hasLocations) return 1;
  if (!hasZones) return 2;
  return 3;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    include: {
      locations: {
        select: { id: true, name: true, city: true, isActive: true, latitude: true, longitude: true },
        orderBy: { name: "asc" },
      },
      zones: { select: { id: true, name: true, isActive: true } },
      rules: { select: { id: true, name: true, type: true, isActive: true } },
    },
  });

  if (!shop) {
    throw new Response("Shop not found — reinstall the app", { status: 404 });
  }

  const url = new URL(request.url);
  const step = pickStep(
    url.searchParams.get("step"),
    shop.locations.length > 0,
    shop.zones.length > 0,
  );

  return json({
    shop: { domain: session.shop },
    step,
    locations: shop.locations,
    zones: shop.zones,
    rules: shop.rules,
  });
}

type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    return json<ActionResult>({ ok: false, error: "Shop not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "create-location": {
        const name = (formData.get("name") as string | null)?.trim() ?? "";
        const address = (formData.get("address") as string | null)?.trim() ?? "";
        if (!name || !address) {
          return json<ActionResult>({ ok: false, error: "Name and address are required" }, { status: 400 });
        }

        const latRaw = formData.get("latitude") as string | null;
        const lngRaw = formData.get("longitude") as string | null;
        const latitude = latRaw ? parseFloat(latRaw) : null;
        const longitude = lngRaw ? parseFloat(lngRaw) : null;

        await prisma.location.create({
          data: {
            shopId: shop.id,
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
            timezone: ((formData.get("timezone") as string | null) || "UTC").trim() || "UTC",
            supportsDelivery: formData.get("supportsDelivery") === "true",
            supportsPickup: formData.get("supportsPickup") === "true",
            isActive: formData.get("isActive") === "true",
          },
        });

        return redirect("/app/setup?step=2");
      }

      case "create-zone": {
        const name = (formData.get("name") as string | null)?.trim() ?? "";
        const locationId = (formData.get("locationId") as string | null) ?? "";
        const type = (formData.get("type") as string | null) ?? "";
        if (!name || !locationId || !type) {
          return json<ActionResult>(
            { ok: false, error: "Name, location, and zone type are required" },
            { status: 400 },
          );
        }

        const location = await prisma.location.findFirst({
          where: { id: locationId, shopId: shop.id },
        });
        if (!location) {
          return json<ActionResult>({ ok: false, error: "Invalid location selected" }, { status: 400 });
        }

        let postcodes: string[] = [];
        let radiusKm: number | null = null;

        if (type === "postcode_list") {
          const raw = (formData.get("postcodes") as string | null) ?? "";
          postcodes = raw.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
          if (postcodes.length === 0) {
            return json<ActionResult>(
              { ok: false, error: "Enter at least one postcode" },
              { status: 400 },
            );
          }
        } else if (type === "postcode_range") {
          const start = ((formData.get("rangeStart") as string | null) || "").trim();
          const end = ((formData.get("rangeEnd") as string | null) || "").trim();
          if (!start || !end) {
            return json<ActionResult>(
              { ok: false, error: "Enter both start and end postcodes for the range" },
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
          if (location.latitude == null || location.longitude == null) {
            return json<ActionResult>(
              {
                ok: false,
                error:
                  "Selected location needs latitude/longitude before it can use a radius zone. Edit the location first.",
              },
              { status: 400 },
            );
          }
          radiusKm = parsed;
        } else {
          return json<ActionResult>({ ok: false, error: "Invalid zone type" }, { status: 400 });
        }

        await prisma.zone.create({
          data: {
            shopId: shop.id,
            locationId,
            name,
            type,
            postcodes,
            radiusKm,
            isActive: formData.get("isActive") === "true",
          },
        });

        return redirect("/app/setup?step=3");
      }

      case "create-rule": {
        const name = (formData.get("name") as string | null)?.trim() ?? "";
        const type = (formData.get("type") as string | null) ?? "";
        if (!name || !type) {
          return json<ActionResult>(
            { ok: false, error: "Name and rule type are required" },
            { status: 400 },
          );
        }

        let cutoffTime: string | null = null;
        let leadTimeHours: number | null = null;
        let leadTimeDays: number | null = null;
        let blackoutDates: Date[] = [];
        let slotDuration: number | null = null;
        let slotCapacity: number | null = null;

        if (type === "cutoff") {
          cutoffTime = ((formData.get("cutoffTime") as string | null) || "").trim();
          if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(cutoffTime)) {
            return json<ActionResult>(
              { ok: false, error: "Cut-off time must be in HH:MM (e.g., 14:00)" },
              { status: 400 },
            );
          }
        } else if (type === "lead_time") {
          const hRaw = (formData.get("leadTimeHours") as string | null) ?? "";
          const dRaw = (formData.get("leadTimeDays") as string | null) ?? "";
          if (hRaw) {
            const h = parseInt(hRaw, 10);
            if (!Number.isFinite(h) || h < 0) {
              return json<ActionResult>(
                { ok: false, error: "Lead time hours must be a non-negative number" },
                { status: 400 },
              );
            }
            leadTimeHours = h;
          }
          if (dRaw) {
            const d = parseInt(dRaw, 10);
            if (!Number.isFinite(d) || d < 0) {
              return json<ActionResult>(
                { ok: false, error: "Lead time days must be a non-negative number" },
                { status: 400 },
              );
            }
            leadTimeDays = d;
          }
          if (leadTimeHours == null && leadTimeDays == null) {
            return json<ActionResult>(
              { ok: false, error: "Enter either hours or days for lead time" },
              { status: 400 },
            );
          }
        } else if (type === "blackout") {
          const raw = (formData.get("blackoutDates") as string | null) ?? "";
          const parts = raw.split(",").map((d) => d.trim()).filter((d) => d.length > 0);
          for (const part of parts) {
            const d = new Date(part);
            if (isNaN(d.getTime())) {
              return json<ActionResult>(
                { ok: false, error: `Invalid date: ${part}. Use YYYY-MM-DD.` },
                { status: 400 },
              );
            }
            blackoutDates.push(d);
          }
          if (blackoutDates.length === 0) {
            return json<ActionResult>(
              { ok: false, error: "Enter at least one blackout date" },
              { status: 400 },
            );
          }
        } else if (type === "capacity") {
          const dRaw = (formData.get("slotDuration") as string | null) ?? "";
          const cRaw = (formData.get("slotCapacity") as string | null) ?? "";
          slotDuration = parseInt(dRaw, 10);
          slotCapacity = parseInt(cRaw, 10);
          if (!Number.isFinite(slotDuration) || slotDuration <= 0) {
            return json<ActionResult>(
              { ok: false, error: "Slot duration must be a positive number" },
              { status: 400 },
            );
          }
          if (!Number.isFinite(slotCapacity) || slotCapacity <= 0) {
            return json<ActionResult>(
              { ok: false, error: "Slot capacity must be a positive number" },
              { status: 400 },
            );
          }
        } else {
          return json<ActionResult>({ ok: false, error: "Invalid rule type" }, { status: 400 });
        }

        await prisma.rule.create({
          data: {
            shopId: shop.id,
            name,
            type,
            cutoffTime,
            leadTimeHours,
            leadTimeDays,
            blackoutDates,
            slotDuration,
            slotCapacity,
            isActive: formData.get("isActive") === "true",
          },
        });

        return redirect("/app");
      }

      case "skip-rules": {
        return redirect("/app");
      }

      default:
        return json<ActionResult>({ ok: false, error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    logger.error("Setup wizard action failed", error, { intent: String(intent) });
    return json<ActionResult>(
      { ok: false, error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

export default function Setup() {
  const { shop, step, locations, zones, rules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Surface action errors as a top-of-page banner. On success the action redirects, so
  // any data here means the submission failed.
  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;

  const goToStep = (n: Step) => {
    const params = new URLSearchParams(searchParams);
    params.set("step", String(n));
    navigate(`/app/setup?${params.toString()}`);
  };

  return (
    <Page
      title="Setup wizard"
      subtitle={`Connected to ${shop.domain}`}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Step {step} of 3 · {STEP_LABELS[step]}
                </Text>
                <InlineStack gap="200">
                  <Badge tone={locations.length > 0 ? "success" : undefined}>
                    {locations.length > 0 ? `${locations.length} location${locations.length === 1 ? "" : "s"}` : "No locations"}
                  </Badge>
                  <Badge tone={zones.length > 0 ? "success" : undefined}>
                    {zones.length > 0 ? `${zones.length} zone${zones.length === 1 ? "" : "s"}` : "No zones"}
                  </Badge>
                  <Badge tone={rules.length > 0 ? "success" : undefined}>
                    {rules.length > 0 ? `${rules.length} rule${rules.length === 1 ? "" : "s"}` : "No rules"}
                  </Badge>
                </InlineStack>
              </InlineStack>
              <ProgressBar progress={(step / 3) * 100} size="small" />
            </BlockStack>
          </Card>
        </Layout.Section>

        {errorMessage && (
          <Layout.Section>
            <Banner tone="critical">{errorMessage}</Banner>
          </Layout.Section>
        )}

        {step === 1 && <LocationStep existingCount={locations.length} onSkip={() => goToStep(2)} />}
        {step === 2 && (
          <ZoneStep
            locations={locations}
            existingCount={zones.length}
            onBack={() => goToStep(1)}
            onSkip={() => goToStep(3)}
          />
        )}
        {step === 3 && (
          <RuleStep
            existingCount={rules.length}
            onBack={() => goToStep(2)}
          />
        )}
      </Layout>
    </Page>
  );
}

// ---------- Step 1: Location ----------

function LocationStep({ existingCount, onSkip }: { existingCount: number; onSkip: () => void }) {
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [country, setCountry] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [supportsDelivery, setSupportsDelivery] = useState(true);
  const [supportsPickup, setSupportsPickup] = useState(true);
  const [isActive, setIsActive] = useState(true);

  return (
    <Layout.Section>
      <Form method="post">
        <input type="hidden" name="intent" value="create-location" />
        <input type="hidden" name="supportsDelivery" value={supportsDelivery.toString()} />
        <input type="hidden" name="supportsPickup" value={supportsPickup.toString()} />
        <input type="hidden" name="isActive" value={isActive.toString()} />
        <FormLayout>
          {existingCount > 0 && (
            <Banner tone="info">
              You already have {existingCount} location{existingCount === 1 ? "" : "s"}. Add another below
              or <Button variant="plain" onClick={onSkip}>continue to zones</Button>.
            </Banner>
          )}

          <Card>
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd" tone="subdued">
                A location is a place orders ship from or are picked up from. You need at least one to accept bookings.
              </Text>

              <TextField
                label="Location name"
                name="name"
                value={name}
                onChange={setName}
                placeholder="e.g., Sydney warehouse"
                autoComplete="off"
                requiredIndicator
              />

              <TextField
                label="Address"
                name="address"
                value={address}
                onChange={setAddress}
                placeholder="123 Main Street"
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
                  <TextField label="Postal code" name="postalCode" value={postalCode} onChange={setPostalCode} autoComplete="off" />
                </div>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">Coordinates (optional)</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Used for distance-based recommendations and radius zones. Find them on Google Maps.
              </Text>
              <InlineStack gap="400">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Latitude"
                    name="latitude"
                    value={latitude}
                    onChange={setLatitude}
                    placeholder="-33.8688"
                    type="number"
                    step={0.000001}
                    autoComplete="off"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Longitude"
                    name="longitude"
                    value={longitude}
                    onChange={setLongitude}
                    placeholder="151.2093"
                    type="number"
                    step={0.000001}
                    autoComplete="off"
                  />
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
                placeholder="UTC"
                helpText="e.g., Australia/Sydney, America/New_York"
                autoComplete="off"
              />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Checkbox
                label="Supports delivery"
                checked={supportsDelivery}
                onChange={setSupportsDelivery}
                helpText="Orders can be dispatched from this location"
              />
              <Checkbox
                label="Supports pickup"
                checked={supportsPickup}
                onChange={setSupportsPickup}
                helpText="Customers can collect from this location"
              />
              <Checkbox
                label="Active"
                checked={isActive}
                onChange={setIsActive}
                helpText="Inactive locations are hidden from customers"
              />
            </BlockStack>
          </Card>

          <InlineStack align="space-between">
            {existingCount > 0 ? (
              <Button onClick={onSkip}>Skip — continue to zones</Button>
            ) : <span />}
            <Button variant="primary" submit loading={isLoading}>
              Save location and continue
            </Button>
          </InlineStack>
        </FormLayout>
      </Form>
    </Layout.Section>
  );
}

// ---------- Step 2: Zone ----------

type LocationOption = {
  id: string;
  name: string;
  city: string | null;
  isActive: boolean;
  latitude: number | null;
  longitude: number | null;
};

function ZoneStep({
  locations,
  existingCount,
  onBack,
  onSkip,
}: {
  locations: LocationOption[];
  existingCount: number;
  onBack: () => void;
  onSkip: () => void;
}) {
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const activeLocations = locations.filter((l) => l.isActive);
  const firstLocation = activeLocations[0]?.id ?? "";

  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState(firstLocation);
  const [type, setType] = useState("postcode_list");
  const [postcodes, setPostcodes] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [radiusKm, setRadiusKm] = useState("");
  const [isActive, setIsActive] = useState(true);

  const locationOptions = [
    { label: "Select a location", value: "" },
    ...activeLocations.map((l) => ({
      label: `${l.name}${l.city ? ` (${l.city})` : ""}`,
      value: l.id,
    })),
  ];

  const typeOptions = [
    { label: "Postcode list", value: "postcode_list" },
    { label: "Postcode range", value: "postcode_range" },
    { label: "Radius from location", value: "radius" },
  ];

  const selectedLocation = locations.find((l) => l.id === locationId);
  const radiusNeedsCoords =
    type === "radius" &&
    selectedLocation &&
    (selectedLocation.latitude == null || selectedLocation.longitude == null);

  if (activeLocations.length === 0) {
    return (
      <Layout.Section>
        <Banner tone="warning" title="No active locations">
          <p>You need at least one active location before you can define zones.</p>
          <InlineStack gap="200">
            <Button onClick={onBack}>Back to locations</Button>
          </InlineStack>
        </Banner>
      </Layout.Section>
    );
  }

  return (
    <Layout.Section>
      <Form method="post">
        <input type="hidden" name="intent" value="create-zone" />
        <input type="hidden" name="isActive" value={isActive.toString()} />
        <FormLayout>
          {existingCount > 0 && (
            <Banner tone="info">
              You already have {existingCount} zone{existingCount === 1 ? "" : "s"}. Add another below
              or <Button variant="plain" onClick={onSkip}>continue to rules</Button>.
            </Banner>
          )}

          <Card>
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd" tone="subdued">
                A zone says which areas a location can serve. Customers outside any zone won&apos;t see
                delivery options for that location.
              </Text>

              <TextField
                label="Zone name"
                name="name"
                value={name}
                onChange={setName}
                placeholder="e.g., Sydney metro"
                autoComplete="off"
                requiredIndicator
              />

              <Select
                label="Location"
                name="locationId"
                options={locationOptions}
                value={locationId}
                onChange={setLocationId}
                helpText="Which location does this zone serve?"
                requiredIndicator
              />

              <Select
                label="Zone type"
                name="type"
                options={typeOptions}
                value={type}
                onChange={setType}
                helpText="How do you want to define this service area?"
                requiredIndicator
              />
            </BlockStack>
          </Card>

          {type === "postcode_list" && (
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">Postcode list</Text>
                <TextField
                  label="Postcodes"
                  name="postcodes"
                  value={postcodes}
                  onChange={setPostcodes}
                  placeholder="e.g., 2000, 2001, 2010, 2060"
                  multiline={3}
                  autoComplete="off"
                  helpText="Separate postcodes with commas"
                  requiredIndicator
                />
              </BlockStack>
            </Card>
          )}

          {type === "postcode_range" && (
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">Postcode range</Text>
                <InlineStack gap="400">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Start postcode"
                      name="rangeStart"
                      value={rangeStart}
                      onChange={setRangeStart}
                      placeholder="e.g., 2000"
                      autoComplete="off"
                      requiredIndicator
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="End postcode"
                      name="rangeEnd"
                      value={rangeEnd}
                      onChange={setRangeEnd}
                      placeholder="e.g., 2100"
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
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">Radius from location</Text>
                {radiusNeedsCoords && (
                  <Banner tone="warning">
                    The selected location has no latitude/longitude. Edit the location to add
                    coordinates before using a radius zone.
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
                  placeholder="e.g., 10"
                  autoComplete="off"
                  helpText="Distance from the location in kilometres"
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
              helpText="Inactive zones are hidden from customers"
            />
          </Card>

          <InlineStack align="space-between">
            <Button onClick={onBack}>Back</Button>
            <InlineStack gap="200">
              {existingCount > 0 && <Button onClick={onSkip}>Skip — continue to rules</Button>}
              <Button variant="primary" submit loading={isLoading}>
                Save zone and continue
              </Button>
            </InlineStack>
          </InlineStack>
        </FormLayout>
      </Form>
    </Layout.Section>
  );
}

// ---------- Step 3: Rule ----------

function RuleStep({ existingCount, onBack }: { existingCount: number; onBack: () => void }) {
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [name, setName] = useState("");
  const [type, setType] = useState("cutoff");
  const [cutoffTime, setCutoffTime] = useState("");
  const [leadTimeHours, setLeadTimeHours] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [blackoutDates, setBlackoutDates] = useState("");
  const [slotDuration, setSlotDuration] = useState("");
  const [slotCapacity, setSlotCapacity] = useState("");
  const [isActive, setIsActive] = useState(true);

  const typeOptions = [
    { label: "Cut-off time", value: "cutoff" },
    { label: "Lead time", value: "lead_time" },
    { label: "Blackout dates", value: "blackout" },
    { label: "Slot capacity", value: "capacity" },
  ];

  return (
    <Layout.Section>
      <BlockStack gap="400">
        <Banner tone="info" title="Rules are optional">
          <p>
            Rules are constraints like daily cut-off times or lead-time minimums. You can skip
            this step and add rules later from <Button variant="plain" url="/app/rules">Rules</Button>.
          </p>
        </Banner>

        <Form method="post">
          <input type="hidden" name="intent" value="create-rule" />
          <input type="hidden" name="isActive" value={isActive.toString()} />
          <FormLayout>
            {existingCount > 0 && (
              <Banner tone="info">
                You already have {existingCount} rule{existingCount === 1 ? "" : "s"}. Add another below or
                finish setup.
              </Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Rule name"
                  name="name"
                  value={name}
                  onChange={setName}
                  placeholder="e.g., Same-day cut-off at 2pm"
                  autoComplete="off"
                  requiredIndicator
                />
                <Select
                  label="Rule type"
                  name="type"
                  options={typeOptions}
                  value={type}
                  onChange={setType}
                  requiredIndicator
                />
              </BlockStack>
            </Card>

            {type === "cutoff" && (
              <Card>
                <BlockStack gap="400">
                  <TextField
                    label="Cut-off time"
                    name="cutoffTime"
                    value={cutoffTime}
                    onChange={setCutoffTime}
                    placeholder="14:00"
                    type="time"
                    autoComplete="off"
                    helpText="Same-day orders placed after this time won't see today's slots"
                    requiredIndicator
                  />
                </BlockStack>
              </Card>
            )}

            {type === "lead_time" && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="400">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Days"
                        name="leadTimeDays"
                        value={leadTimeDays}
                        onChange={setLeadTimeDays}
                        type="number"
                        min={0}
                        placeholder="e.g., 1"
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Hours"
                        name="leadTimeHours"
                        value={leadTimeHours}
                        onChange={setLeadTimeHours}
                        type="number"
                        min={0}
                        placeholder="e.g., 24"
                        autoComplete="off"
                      />
                    </div>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {type === "blackout" && (
              <Card>
                <BlockStack gap="400">
                  <TextField
                    label="Blackout dates"
                    name="blackoutDates"
                    value={blackoutDates}
                    onChange={setBlackoutDates}
                    placeholder="e.g., 2026-12-25, 2026-12-26, 2027-01-01"
                    multiline={3}
                    autoComplete="off"
                    helpText="YYYY-MM-DD, comma-separated"
                    requiredIndicator
                  />
                </BlockStack>
              </Card>
            )}

            {type === "capacity" && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="400">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Slot duration (minutes)"
                        name="slotDuration"
                        value={slotDuration}
                        onChange={setSlotDuration}
                        type="number"
                        min={1}
                        placeholder="e.g., 60"
                        autoComplete="off"
                        requiredIndicator
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Max orders per slot"
                        name="slotCapacity"
                        value={slotCapacity}
                        onChange={setSlotCapacity}
                        type="number"
                        min={1}
                        placeholder="e.g., 10"
                        autoComplete="off"
                        requiredIndicator
                      />
                    </div>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            <Card>
              <Checkbox
                label="Active"
                checked={isActive}
                onChange={setIsActive}
                helpText="Inactive rules aren't enforced"
              />
            </Card>

            <InlineStack align="space-between">
              <Button onClick={onBack}>Back</Button>
              <Button variant="primary" submit loading={isLoading}>
                Save rule and finish
              </Button>
            </InlineStack>
          </FormLayout>
        </Form>

        <Form method="post">
          <input type="hidden" name="intent" value="skip-rules" />
          <InlineStack align="end">
            <Button submit>Skip rules and finish setup</Button>
          </InlineStack>
        </Form>
      </BlockStack>
    </Layout.Section>
  );
}
