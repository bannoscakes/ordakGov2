/**
 * Create New Zone Page
 * Form to create a new service zone
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
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
  Text,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  // Get all active locations for the dropdown
  const locations = await prisma.location.findMany({
    where: {
      shopId: shop.id,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      city: true,
      latitude: true,
      longitude: true,
    },
    orderBy: { name: "asc" },
  });

  // Pre-select location when navigated from the per-location admin
  // (e.g. /app/zones/new?locationId=abc123).
  const url = new URL(request.url);
  const prefillLocationId = url.searchParams.get("locationId") || "";
  const validPrefill = locations.some((l) => l.id === prefillLocationId)
    ? prefillLocationId
    : "";

  return json({ shop, locations, prefillLocationId: validPrefill });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const name = formData.get("name") as string;
  const locationId = formData.get("locationId") as string;
  const type = formData.get("type") as string;
  const isActive = formData.get("isActive") === "true";

  // Validation
  if (!name || !locationId || !type) {
    return json(
      { error: "Name, location, and zone type are required" },
      { status: 400 }
    );
  }

  // Validate location belongs to shop
  const location = await prisma.location.findFirst({
    where: {
      id: locationId,
      shopId: shop.id,
    },
  });

  if (!location) {
    return json(
      { error: "Invalid location selected" },
      { status: 400 }
    );
  }

  // Type-specific validation and data preparation
  let postcodes: string[] = [];
  let radiusKm: number | null = null;

  switch (type) {
    case "postcode_list": {
      const postcodeInput = formData.get("postcodes") as string;
      if (!postcodeInput || postcodeInput.trim() === "") {
        return json(
          { error: "Please enter at least one postcode" },
          { status: 400 }
        );
      }
      // Split by comma, trim whitespace, remove empty entries
      postcodes = postcodeInput
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      if (postcodes.length === 0) {
        return json(
          { error: "Please enter at least one valid postcode" },
          { status: 400 }
        );
      }
      break;
    }

    case "postcode_range": {
      const rangeStart = formData.get("rangeStart") as string;
      const rangeEnd = formData.get("rangeEnd") as string;

      if (!rangeStart || !rangeEnd) {
        return json(
          { error: "Please enter both start and end postcodes for the range" },
          { status: 400 }
        );
      }

      // Store range as array [start, end]
      postcodes = [rangeStart.trim(), rangeEnd.trim()];
      break;
    }

    case "radius": {
      const radiusInput = formData.get("radiusKm") as string;
      if (!radiusInput) {
        return json(
          { error: "Please enter a radius in kilometers" },
          { status: 400 }
        );
      }

      radiusKm = parseFloat(radiusInput);

      if (isNaN(radiusKm) || radiusKm <= 0) {
        return json(
          { error: "Radius must be a positive number" },
          { status: 400 }
        );
      }

      // Verify location has coordinates
      if (!location.latitude || !location.longitude) {
        return json(
          { error: "Selected location must have coordinates (latitude/longitude) to use radius-based zones" },
          { status: 400 }
        );
      }
      break;
    }

    default:
      return json(
        { error: "Invalid zone type" },
        { status: 400 }
      );
  }

  // Create zone
  try {
    await prisma.zone.create({
      data: {
        shopId: shop.id,
        locationId,
        name,
        type,
        postcodes,
        radiusKm,
        isActive,
      },
    });

    return redirect("/app/zones");
  } catch (error) {
    return json(
      { error: "Failed to create zone" },
      { status: 500 }
    );
  }
}

export default function NewZone() {
  const { locations, prefillLocationId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState(prefillLocationId);
  const [type, setType] = useState("postcode_list");
  const [postcodes, setPostcodes] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [radiusKm, setRadiusKm] = useState("");
  const [isActive, setIsActive] = useState(true);

  const locationOptions = [
    { label: "Select a location", value: "" },
    ...locations.map((loc) => ({
      label: `${loc.name}${loc.city ? ` (${loc.city})` : ""}`,
      value: loc.id,
    })),
  ];

  const typeOptions = [
    { label: "Postcode List", value: "postcode_list" },
    { label: "Postcode Range", value: "postcode_range" },
    { label: "Radius", value: "radius" },
  ];

  const selectedLocation = locations.find((loc) => loc.id === locationId);
  const showRadiusWarning =
    type === "radius" &&
    locationId &&
    selectedLocation &&
    (!selectedLocation.latitude || !selectedLocation.longitude);

  return (
    <Page
      title="Create Service Zone"
      backAction={{ content: "Zones", url: "/app/zones" }}
    >
      <Layout>
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical">{actionData.error}</Banner>
          </Layout.Section>
        )}

        {locations.length === 0 && (
          <Layout.Section>
            <Banner tone="warning">
              You need to create at least one active location before creating zones.{" "}
              <Button
                variant="plain"
                onClick={() => navigate("/app/locations/new")}
              >
                Create a location
              </Button>
            </Banner>
          </Layout.Section>
        )}

        <Form method="post">
          <Layout.AnnotatedSection
            title="Zone basics"
            description="Name, location, and how you want to define the service area."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Zone name"
                  name="name"
                  value={name}
                  onChange={setName}
                  placeholder="e.g., Sydney Metro Area"
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
                  helpText="Postcode list, postcode range, or radius around the location."
                  requiredIndicator
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          {type === "postcode_list" && (
            <Layout.AnnotatedSection
              title="Postcode list"
              description="Enter every postcode this zone covers, separated by commas."
            >
              <Card>
                <TextField
                  label="Postcodes"
                  name="postcodes"
                  value={postcodes}
                  onChange={setPostcodes}
                  placeholder="e.g., 2000, 2001, 2010, 2060"
                  multiline={3}
                  autoComplete="off"
                  helpText="Separate postcodes with commas."
                  requiredIndicator
                />
              </Card>
            </Layout.AnnotatedSection>
          )}

          {type === "postcode_range" && (
            <Layout.AnnotatedSection
              title="Postcode range"
              description="Inclusive range — every postcode between the start and end values."
            >
              <Card>
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
              </Card>
            </Layout.AnnotatedSection>
          )}

          {type === "radius" && (
            <Layout.AnnotatedSection
              title="Radius zone"
              description="Cover every address within a set distance of the location's coordinates."
            >
              <Card>
                <BlockStack gap="400">
                  {showRadiusWarning && (
                    <Banner tone="warning">
                      The selected location doesn't have coordinates set. Edit the location and
                      add latitude/longitude to use radius-based zones.
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
                    helpText="Distance from the location in kilometers."
                    requiredIndicator
                  />
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>
          )}

          <Layout.AnnotatedSection
            title="Activation"
            description="Only active zones appear in the cart-block for customers."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Active"
                  checked={isActive}
                  onChange={setIsActive}
                  helpText="Only active zones are shown to customers."
                />
                <input
                  type="hidden"
                  name="isActive"
                  value={isActive.toString()}
                />
                <InlineStack align="end" gap="200">
                  <Button onClick={() => navigate("/app/zones")}>Cancel</Button>
                  <Button
                    variant="primary"
                    submit
                    loading={isLoading}
                    disabled={isLoading || locations.length === 0}
                  >
                    Create zone
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Form>
      </Layout>
    </Page>
  );
}
