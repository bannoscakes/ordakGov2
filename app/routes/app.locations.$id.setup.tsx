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
  Layout,
  Card,
  TextField,
  Checkbox,
  Banner,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import { SaveBar } from "@shopify/app-bridge-react";
import { useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { isValidIanaTimezone } from "../services/slot-cutoff.server";
import { useDirtyForm } from "../components/useDirtyForm";
import { useToastFeedback } from "../components/useToastFeedback";
import { SaveBarButton } from "../components/SaveBarButton";

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
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      province: true,
      country: true,
      postalCode: true,
      latitude: true,
      longitude: true,
      phone: true,
      email: true,
      timezone: true,
      isActive: true,
    },
  });
  if (!location) throw new Response("Location not found", { status: 404 });

  return json({ location });
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

  try {
    const formData = await request.formData();
    const name = ((formData.get("name") as string | null) || "").trim();
    const address = ((formData.get("address") as string | null) || "").trim();
    if (!name || !address) {
      return json<ActionResult>(
        { ok: false, error: "Name and address are required" },
        { status: 400 },
      );
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
    return redirect(`/app/locations/${id}/setup?saved=1`);
  } catch (error) {
    logger.error("Location setup save failed", error, { locationId: id });
    return json<ActionResult>(
      { ok: false, error: "Save failed. Please try again." },
      { status: 500 },
    );
  }
}

export default function LocationSetup() {
  const { location } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [searchParams, setSearchParams] = useSearchParams();
  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;
  const justSaved = searchParams.get("saved") === "1";

  const baselineFromLocation = () => ({
    name: location.name,
    address: location.address,
    city: location.city ?? "",
    province: location.province ?? "",
    country: location.country ?? "",
    postalCode: location.postalCode ?? "",
    latitude: location.latitude?.toString() ?? "",
    longitude: location.longitude?.toString() ?? "",
    phone: location.phone ?? "",
    email: location.email ?? "",
    timezone: location.timezone ?? "UTC",
    isActive: location.isActive,
  });
  const { values, setField, isDirty, reset, rebaseline } = useDirtyForm(baselineFromLocation());

  const formRef = useRef<HTMLFormElement>(null);
  const { showToast } = useToastFeedback();

  useEffect(() => {
    if (justSaved && !errorMessage) {
      rebaseline(baselineFromLocation());
      showToast("Saved");
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("saved");
          return next;
        },
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justSaved, errorMessage, location.name, location.address, location.timezone, location.isActive]);

  return (
    <>
      <Form method="post" ref={formRef}>
        <input type="hidden" name="isActive" value={values.isActive.toString()} />

        <Layout>
          {errorMessage && (
            <Layout.Section>
              <Banner tone="critical">{errorMessage}</Banner>
            </Layout.Section>
          )}

          <Layout.AnnotatedSection
            title="Address"
            description="Where the location ships from or customers pick up from."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Location name"
                  name="name"
                  value={values.name}
                  onChange={(v) => setField("name", v)}
                  autoComplete="off"
                  requiredIndicator
                />
                <TextField
                  label="Address"
                  name="address"
                  value={values.address}
                  onChange={(v) => setField("address", v)}
                  autoComplete="off"
                  requiredIndicator
                />
                <InlineStack gap="400">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="City"
                      name="city"
                      value={values.city}
                      onChange={(v) => setField("city", v)}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Province / state"
                      name="province"
                      value={values.province}
                      onChange={(v) => setField("province", v)}
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
                <InlineStack gap="400">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Country"
                      name="country"
                      value={values.country}
                      onChange={(v) => setField("country", v)}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Postcode"
                      name="postalCode"
                      value={values.postalCode}
                      onChange={(v) => setField("postalCode", v)}
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
                    value={values.latitude}
                    onChange={(v) => setField("latitude", v)}
                    type="number"
                    step={0.000001}
                    autoComplete="off"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Longitude"
                    name="longitude"
                    value={values.longitude}
                    onChange={(v) => setField("longitude", v)}
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
                      value={values.phone}
                      onChange={(v) => setField("phone", v)}
                      type="tel"
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Email"
                      name="email"
                      value={values.email}
                      onChange={(v) => setField("email", v)}
                      type="email"
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
                <TextField
                  label="Timezone"
                  name="timezone"
                  value={values.timezone}
                  onChange={(v) => setField("timezone", v)}
                  helpText="IANA name like Australia/Sydney or America/New_York."
                  autoComplete="off"
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Activation"
            description="Inactive locations are hidden from customers."
          >
            <Card>
              <Checkbox
                label="Active"
                checked={values.isActive}
                onChange={(checked) => setField("isActive", checked)}
              />
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </Form>

      <SaveBar id="location-setup-save-bar" open={isDirty}>
        <SaveBarButton
          variant="primary"
          onClick={() => formRef.current?.requestSubmit()}
          loading={isLoading}
        >
          Save
        </SaveBarButton>
        <SaveBarButton onClick={reset} disabled={isLoading}>
          Discard
        </SaveBarButton>
      </SaveBar>
    </>
  );
}
