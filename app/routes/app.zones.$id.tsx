/**
 * Edit Zone Page
 * Form to edit or delete an existing zone
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigate, useNavigation, useSubmit } from "@remix-run/react";
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
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const { id } = params;

  if (!id) {
    throw new Response("Zone ID is required", { status: 400 });
  }

  const zone = await prisma.zone.findUnique({
    where: { id },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          city: true,
          latitude: true,
          longitude: true,
        },
      },
    },
  });

  if (!zone) {
    throw new Response("Zone not found", { status: 404 });
  }

  // Get all active locations for the dropdown
  const locations = await prisma.location.findMany({
    where: {
      shopId: zone.shopId,
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

  return json({ zone, locations });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    return json({ error: "Zone ID is required" }, { status: 400 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Handle delete
  if (intent === "delete") {
    try {
      await prisma.zone.delete({
        where: { id },
      });

      return redirect("/app/zones");
    } catch (error) {
      return json(
        { error: "Failed to delete zone" },
        { status: 500 }
      );
    }
  }

  // Handle update
  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

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

  // Update zone
  try {
    await prisma.zone.update({
      where: { id },
      data: {
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
      { error: "Failed to update zone" },
      { status: 500 }
    );
  }
}

export default function EditZone() {
  const { zone, locations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isLoading = navigation.state === "submitting";

  const [name, setName] = useState(zone.name);
  const [locationId, setLocationId] = useState(zone.locationId);
  const [type, setType] = useState(zone.type);
  const [isActive, setIsActive] = useState(zone.isActive);
  const [deleteModalActive, setDeleteModalActive] = useState(false);

  // Initialize type-specific fields
  const [postcodes, setPostcodes] = useState(() => {
    if (zone.type === "postcode_list") {
      return zone.postcodes?.join(", ") || "";
    }
    return "";
  });

  const [rangeStart, setRangeStart] = useState(() => {
    if (zone.type === "postcode_range" && zone.postcodes && zone.postcodes.length >= 1) {
      return zone.postcodes[0];
    }
    return "";
  });

  const [rangeEnd, setRangeEnd] = useState(() => {
    if (zone.type === "postcode_range" && zone.postcodes && zone.postcodes.length >= 2) {
      return zone.postcodes[1];
    }
    return "";
  });

  const [radiusKm, setRadiusKm] = useState(() => {
    if (zone.type === "radius" && zone.radiusKm) {
      return zone.radiusKm.toString();
    }
    return "";
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    form.submit();
  };

  const handleDelete = () => {
    const formData = new FormData();
    formData.append("intent", "delete");
    submit(formData, { method: "post" });
    setDeleteModalActive(false);
  };

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
      title={`Edit Zone: ${zone.name}`}
      backAction={{ content: "Zones", url: "/app/zones" }}
      secondaryActions={[
        {
          content: "Delete Zone",
          destructive: true,
          onAction: () => setDeleteModalActive(true),
        },
      ]}
    >
      <Layout>
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical">{actionData.error}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <form method="post" onSubmit={handleSubmit}>
            <FormLayout>
              <Card>
                <BlockStack gap="400">
                  <TextField
                    label="Zone Name"
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
                    label="Zone Type"
                    name="type"
                    options={typeOptions}
                    value={type}
                    onChange={setType}
                    helpText="How do you want to define this service area?"
                    requiredIndicator
                  />
                </BlockStack>
              </Card>

              {/* Conditional fields based on zone type */}
              {type === "postcode_list" && (
                <Card>
                  <BlockStack gap="400">
                    <div>
                      <Text as="h3" variant="headingMd">
                        Postcode List
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Enter specific postcodes separated by commas
                      </Text>
                    </div>
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
                    <div>
                      <Text as="h3" variant="headingMd">
                        Postcode Range
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Define a range of postcodes (inclusive)
                      </Text>
                    </div>
                    <InlineStack gap="400">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Start Postcode"
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
                          label="End Postcode"
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
                    <div>
                      <Text as="h3" variant="headingMd">
                        Radius Zone
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Serve all addresses within a certain distance from the location
                      </Text>
                    </div>

                    {showRadiusWarning && (
                      <Banner tone="warning">
                        The selected location doesn't have coordinates set. Please edit
                        the location and add latitude/longitude to use radius-based zones.
                      </Banner>
                    )}

                    <TextField
                      label="Radius (km)"
                      name="radiusKm"
                      value={radiusKm}
                      onChange={setRadiusKm}
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="e.g., 10"
                      autoComplete="off"
                      helpText="Distance from the location in kilometers"
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
                  helpText="Only active zones are shown to customers"
                />
                <input
                  type="hidden"
                  name="isActive"
                  value={isActive.toString()}
                />
              </Card>

              <InlineStack align="end" gap="200">
                <Button onClick={() => navigate("/app/zones")}>Cancel</Button>
                <Button variant="primary" submit loading={isLoading}>
                  Save Changes
                </Button>
              </InlineStack>
            </FormLayout>
          </form>
        </Layout.Section>
      </Layout>

      <Modal
        open={deleteModalActive}
        onClose={() => setDeleteModalActive(false)}
        title="Delete Zone"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDelete,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteModalActive(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              Are you sure you want to delete the zone "{zone.name}"?
            </Text>
            <Text as="p" tone="critical">
              This action cannot be undone. Customers in this zone will no longer
              see available slots from the linked location.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
