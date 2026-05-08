/**
 * New Location Page
 * Form to create a new location
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigate, useNavigation } from "@remix-run/react";
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
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { isValidIanaTimezone } from "../services/slot-cutoff.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
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

  const tz = (timezone || "UTC").trim() || "UTC";
  if (!isValidIanaTimezone(tz)) {
    return json(
      { error: `Invalid timezone "${tz}". Use an IANA name like "Australia/Sydney" or "UTC".` },
      { status: 400 },
    );
  }

  // Get shop
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  // Create location
  const location = await prisma.location.create({
    data: {
      shopId: shop.id,
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
      timezone: tz,
      supportsDelivery,
      supportsPickup,
      isActive,
    },
  });

  return redirect(`/app/locations`);
}

export default function NewLocation() {
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
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
    <Page
      title="Add Location"
      backAction={{ content: "Locations", url: "/app/locations" }}
    >
      <Layout>
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical">{actionData.error}</Banner>
          </Layout.Section>
        )}

        <Form method="post">
          <Layout.AnnotatedSection
            title="Address"
            description="Where the location ships from or customers pick up from."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Location name"
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
                      label="Province / state"
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
                      label="Postal code"
                      name="postalCode"
                      value={postalCode}
                      onChange={setPostalCode}
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Coordinates"
            description="Optional. Required for radius-based delivery zones that calculate distance from this location."
          >
            <Card>
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
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Contact &amp; timezone"
            description="Phone and email shown to customers. Timezone drives slot scheduling and cutoff calculations."
          >
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
                  helpText="IANA name like Australia/Sydney or America/New_York."
                  autoComplete="off"
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Fulfillment capabilities"
            description="Pick what this location can do. Customers only see active locations in the cart-block."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Supports delivery"
                  checked={supportsDelivery}
                  onChange={setSupportsDelivery}
                  helpText="Enable if this location can dispatch deliveries."
                />
                <input
                  type="hidden"
                  name="supportsDelivery"
                  value={supportsDelivery.toString()}
                />

                <Checkbox
                  label="Supports pickup"
                  checked={supportsPickup}
                  onChange={setSupportsPickup}
                  helpText="Enable if customers can pick up orders from this location."
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
                  helpText="Only active locations are shown to customers."
                />
                <input
                  type="hidden"
                  name="isActive"
                  value={isActive.toString()}
                />

                <InlineStack align="end" gap="200">
                  <Button onClick={() => navigate("/app/locations")}>Cancel</Button>
                  <Button variant="primary" submit loading={isLoading} disabled={isLoading}>
                    Add location
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
