/**
 * Edit Location Page
 * Form to edit or delete an existing location
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
    throw new Response("Location ID is required", { status: 400 });
  }

  const location = await prisma.location.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          slots: true,
          zones: true,
        },
      },
    },
  });

  if (!location) {
    throw new Response("Location not found", { status: 404 });
  }

  return json({ location });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    return json({ error: "Location ID is required" }, { status: 400 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Handle delete
  if (intent === "delete") {
    try {
      // Check if location has any active slots or zones
      const location = await prisma.location.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              slots: true,
              zones: true,
            },
          },
        },
      });

      if (location && (location._count.slots > 0 || location._count.zones > 0)) {
        return json(
          {
            error: `Cannot delete location. It has ${location._count.slots} slots and ${location._count.zones} zones. Please remove these first.`,
          },
          { status: 400 }
        );
      }

      await prisma.location.delete({
        where: { id },
      });

      return redirect("/app/locations");
    } catch (error) {
      return json(
        { error: "Failed to delete location" },
        { status: 500 }
      );
    }
  }

  // Handle update
  const name = formData.get("name") as string;
  const address = formData.get("address") as string;
  const city = formData.get("city") as string;
  const province = formData.get("province") as string;
  const country = formData.get("country") as string;
  const postalCode = formData.get("postalCode") as string;
  const latitude = formData.get("latitude") as string;
  const longitude = formData.get("longitude") as string;
  const phone = formData.get("phone") as string;
  const email = formData.get("email") as string;
  const timezone = formData.get("timezone") as string;
  const supportsDelivery = formData.get("supportsDelivery") === "true";
  const supportsPickup = formData.get("supportsPickup") === "true";
  const isActive = formData.get("isActive") === "true";

  // Validation
  if (!name || !address) {
    return json(
      { error: "Name and address are required" },
      { status: 400 }
    );
  }

  // Update location
  try {
    await prisma.location.update({
      where: { id },
      data: {
        name,
        address,
        city: city || null,
        province: province || null,
        country: country || null,
        postalCode: postalCode || null,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        phone: phone || null,
        email: email || null,
        timezone: timezone || "UTC",
        supportsDelivery,
        supportsPickup,
        isActive,
      },
    });

    return redirect("/app/locations");
  } catch (error) {
    return json(
      { error: "Failed to update location" },
      { status: 500 }
    );
  }
}

export default function EditLocation() {
  const { location } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();
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
  const [supportsDelivery, setSupportsDelivery] = useState(location.supportsDelivery);
  const [supportsPickup, setSupportsPickup] = useState(location.supportsPickup);
  const [isActive, setIsActive] = useState(location.isActive);
  const [deleteModalActive, setDeleteModalActive] = useState(false);

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

  const hasUsage = (location._count.slots > 0 || location._count.zones > 0);

  return (
    <Page
      title={`Edit Location: ${location.name}`}
      backAction={{ content: "Locations", url: "/app/locations" }}
      secondaryActions={[
        {
          content: "Delete Location",
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

        {hasUsage && (
          <Layout.Section>
            <Banner tone="info">
              This location has {location._count.slots} slot(s) and {location._count.zones} zone(s).
              To delete this location, you must first remove all associated slots and zones.
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <form method="post" onSubmit={handleSubmit}>
            <FormLayout>
              <Card>
                <BlockStack gap="400">
                  <TextField
                    label="Location Name"
                    name="name"
                    value={name}
                    onChange={setName}
                    placeholder="e.g., Sydney Warehouse"
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
                      <TextField
                        label="City"
                        name="city"
                        value={city}
                        onChange={setCity}
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Province/State"
                        name="province"
                        value={province}
                        onChange={setProvince}
                        autoComplete="off"
                      />
                    </div>
                  </InlineStack>

                  <InlineStack gap="400">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Country"
                        name="country"
                        value={country}
                        onChange={setCountry}
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Postal Code"
                        name="postalCode"
                        value={postalCode}
                        onChange={setPostalCode}
                        autoComplete="off"
                      />
                    </div>
                  </InlineStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <div>
                    <h3 style={{ marginBottom: "8px" }}>Coordinates (Optional)</h3>
                    <p style={{ color: "#6d7175", fontSize: "13px", marginBottom: "12px" }}>
                      Used for distance calculations in recommendations. You can find
                      coordinates using Google Maps.
                    </p>
                  </div>

                  <InlineStack gap="400">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Latitude"
                        name="latitude"
                        value={latitude}
                        onChange={setLatitude}
                        placeholder="-33.8688"
                        type="number"
                        step="any"
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
                        step="any"
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
                      <TextField
                        label="Phone"
                        name="phone"
                        value={phone}
                        onChange={setPhone}
                        type="tel"
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Email"
                        name="email"
                        value={email}
                        onChange={setEmail}
                        type="email"
                        autoComplete="off"
                      />
                    </div>
                  </InlineStack>

                  <TextField
                    label="Timezone"
                    name="timezone"
                    value={timezone}
                    onChange={setTimezone}
                    placeholder="UTC"
                    helpText="e.g., America/New_York, Australia/Sydney"
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Checkbox
                    label="Supports Delivery"
                    checked={supportsDelivery}
                    onChange={setSupportsDelivery}
                    helpText="Enable if this location can dispatch deliveries"
                  />
                  <input
                    type="hidden"
                    name="supportsDelivery"
                    value={supportsDelivery.toString()}
                  />

                  <Checkbox
                    label="Supports Pickup"
                    checked={supportsPickup}
                    onChange={setSupportsPickup}
                    helpText="Enable if customers can pick up orders from this location"
                  />
                  <input
                    type="hidden"
                    name="supportsPickup"
                    value={supportsPickup.toString()}
                  />

                  <Checkbox
                    label="Active"
                    checked={isActive}
                    onChange={setIsActive}
                    helpText="Only active locations are shown to customers"
                  />
                  <input
                    type="hidden"
                    name="isActive"
                    value={isActive.toString()}
                  />
                </BlockStack>
              </Card>

              <InlineStack align="end" gap="200">
                <Button onClick={() => navigate("/app/locations")}>Cancel</Button>
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
        title="Delete Location"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDelete,
          disabled: hasUsage,
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
              Are you sure you want to delete the location "{location.name}"?
            </Text>
            {hasUsage ? (
              <Banner tone="critical">
                This location cannot be deleted because it has {location._count.slots} slot(s)
                and {location._count.zones} zone(s). Please remove these first.
              </Banner>
            ) : (
              <Text as="p" tone="critical">
                This action cannot be undone.
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
