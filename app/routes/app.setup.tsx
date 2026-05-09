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

type Step = 1 | 2;

const STEP_LABELS: Record<Step, string> = {
  1: "Add a location",
  2: "Define a service zone",
};

function pickStep(searchParam: string | null, hasLocations: boolean, hasZones: boolean): Step {
  const parsed = searchParam ? Number(searchParam) : NaN;
  if (parsed === 1 || parsed === 2) return parsed;
  if (!hasLocations) return 1;
  if (!hasZones) return 2;
  // Both present and the loader didn't redirect (caller passed an explicit
  // step param) → treat as "edit zone again" by returning step 2.
  return 2;
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
    },
  });

  if (!shop) {
    throw new Response("Shop not found — reinstall the app", { status: 404 });
  }

  const url = new URL(request.url);
  const stepParam = url.searchParams.get("step");

  const hasActiveLocation = shop.locations.some((l) => l.isActive);
  const hasActiveZone = shop.zones.some((z) => z.isActive);

  // Once the merchant has at least one ACTIVE location AND one ACTIVE zone,
  // the wizard's job is done — the Setup Guide on /app takes over. Inactive
  // entries don't count: a merchant who deactivated everything came here
  // because they need to fix it. Bypass the wizard only when the merchant
  // didn't explicitly request a step (e.g. ?step=1 to add another).
  if (!stepParam && hasActiveLocation && hasActiveZone) {
    return redirect("/app");
  }

  const step = pickStep(stepParam, hasActiveLocation, hasActiveZone);

  return json({
    shop: { domain: session.shop },
    step,
    locations: shop.locations,
    zones: shop.zones,
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

        const supportsDelivery = formData.get("supportsDelivery") === "true";
        const supportsPickup = formData.get("supportsPickup") === "true";

        const created = await prisma.location.create({
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
            supportsDelivery,
            supportsPickup,
            isActive: formData.get("isActive") === "true",
          },
        });

        // Pickup-supporting locations need hours configured before customers
        // can book — and there's no way to do that from anywhere else in the
        // wizard. Detour through the pickup-hours editor first; the banner
        // there continues to either /app/setup?step=2 (if delivery is also
        // enabled) or /app (if pickup-only).
        if (supportsPickup) {
          return redirect(`/app/locations/${created.id}?section=pickup-hours&from=wizard`);
        }
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

        const created = await prisma.zone.create({
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

        // Hand off to the per-zone admin's slots tab so the merchant
        // configures time slots immediately after creating the zone.
        // The Setup Guide on /app picks up the rest of the checklist.
        return redirect(`/app/zones/${created.id}?section=slots&from=wizard`);
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
  const { shop, step, locations, zones } = useLoaderData<typeof loader>();
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
                  Step {step} of 2 · {STEP_LABELS[step]}
                </Text>
                <InlineStack gap="200">
                  <Badge tone={locations.length > 0 ? "success" : undefined}>
                    {locations.length > 0 ? `${locations.length} location${locations.length === 1 ? "" : "s"}` : "No locations"}
                  </Badge>
                  <Badge tone={zones.length > 0 ? "success" : undefined}>
                    {zones.length > 0 ? `${zones.length} zone${zones.length === 1 ? "" : "s"}` : "No zones"}
                  </Badge>
                </InlineStack>
              </InlineStack>
              <ProgressBar progress={(step / 2) * 100} size="small" />
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
            onSkip={() => navigate("/app")}
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
              or <Button variant="plain" onClick={onSkip}>finish setup</Button>.
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
              {existingCount > 0 && <Button onClick={onSkip}>Finish setup</Button>}
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

