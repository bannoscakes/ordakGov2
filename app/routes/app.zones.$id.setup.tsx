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
  Select,
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
import { useDirtyForm } from "../components/useDirtyForm";
import { useToastFeedback } from "../components/useToastFeedback";
import { SaveBarButton } from "../components/SaveBarButton";

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
      location: { select: { id: true, name: true, latitude: true, longitude: true } },
    },
  });
  if (!zone) throw new Response("Zone not found", { status: 404 });

  return json({
    zone: {
      id: zone.id,
      name: zone.name,
      type: zone.type,
      postcodes: zone.postcodes,
      radiusKm: zone.radiusKm,
      isActive: zone.isActive,
      priority: zone.priority,
      location: zone.location,
    },
  });
}

type ActionResult = { ok: true } | { ok: false; error: string };

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

  try {
    const formData = await request.formData();
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
    return redirect(`/app/zones/${id}/setup?saved=1`);
  } catch (error) {
    logger.error("Zone setup save failed", error, { zoneId: id });
    return json<ActionResult>(
      { ok: false, error: "Save failed. Please try again." },
      { status: 500 },
    );
  }
}

export default function ZoneSetup() {
  const { zone } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [searchParams, setSearchParams] = useSearchParams();
  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;
  const justSaved = searchParams.get("saved") === "1";

  const baselineFromZone = () => ({
    name: zone.name,
    type: zone.type,
    priority: String(zone.priority),
    postcodes: zone.type === "postcode_list" ? zone.postcodes.join(", ") : "",
    rangeStart:
      zone.type === "postcode_range" && zone.postcodes.length >= 1 ? zone.postcodes[0] : "",
    rangeEnd:
      zone.type === "postcode_range" && zone.postcodes.length >= 2 ? zone.postcodes[1] : "",
    radiusKm: zone.radiusKm ? String(zone.radiusKm) : "",
    isActive: zone.isActive,
  });

  const { values, setField, isDirty, reset, rebaseline } = useDirtyForm(baselineFromZone());

  const formRef = useRef<HTMLFormElement>(null);
  const { showToast } = useToastFeedback();

  useEffect(() => {
    if (justSaved && !errorMessage) {
      rebaseline(baselineFromZone());
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
  }, [justSaved, errorMessage, zone.name, zone.type, zone.priority, zone.radiusKm, zone.isActive]);

  const radiusNeedsCoords =
    values.type === "radius" &&
    (zone.location.latitude == null || zone.location.longitude == null);

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
            title="Zone basics"
            description="Name, match type, and priority. Higher priority zones win when a postcode matches more than one zone."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Zone name"
                  name="name"
                  value={values.name}
                  onChange={(v) => setField("name", v)}
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
                  value={values.type}
                  onChange={(v) => setField("type", v)}
                  requiredIndicator
                />
                <TextField
                  label="Priority"
                  name="priority"
                  value={values.priority}
                  onChange={(v) => setField("priority", v)}
                  type="number"
                  min={0}
                  helpText="Higher numbers match first when a postcode is in multiple zones."
                  autoComplete="off"
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          {values.type === "postcode_list" && (
            <Layout.AnnotatedSection
              title="Postcodes"
              description="Every postcode this zone covers, separated by commas."
            >
              <Card>
                <TextField
                  label="Postcodes"
                  name="postcodes"
                  value={values.postcodes}
                  onChange={(v) => setField("postcodes", v)}
                  placeholder="e.g., 2000, 2001, 2010, 2060"
                  multiline={3}
                  autoComplete="off"
                  helpText="Separate with commas."
                  requiredIndicator
                />
              </Card>
            </Layout.AnnotatedSection>
          )}

          {values.type === "postcode_range" && (
            <Layout.AnnotatedSection
              title="Postcode range"
              description="Inclusive range — every postcode between the start and end values."
            >
              <Card>
                <InlineStack gap="400">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Start"
                      name="rangeStart"
                      value={values.rangeStart}
                      onChange={(v) => setField("rangeStart", v)}
                      autoComplete="off"
                      requiredIndicator
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="End"
                      name="rangeEnd"
                      value={values.rangeEnd}
                      onChange={(v) => setField("rangeEnd", v)}
                      autoComplete="off"
                      requiredIndicator
                    />
                  </div>
                </InlineStack>
              </Card>
            </Layout.AnnotatedSection>
          )}

          {values.type === "radius" && (
            <Layout.AnnotatedSection
              title="Radius"
              description="Cover every address within a set distance of the location's coordinates."
            >
              <Card>
                <BlockStack gap="400">
                  {radiusNeedsCoords && (
                    <Banner tone="warning">
                      This zone&apos;s location ({zone.location.name}) has no latitude/longitude.
                      Edit the location and set coordinates first.
                    </Banner>
                  )}
                  <TextField
                    label="Radius (km)"
                    name="radiusKm"
                    value={values.radiusKm}
                    onChange={(v) => setField("radiusKm", v)}
                    type="number"
                    step={0.1}
                    min={0}
                    autoComplete="off"
                    requiredIndicator
                  />
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>
          )}

          <Layout.AnnotatedSection
            title="Activation"
            description="Inactive zones are hidden from customers and Carrier Service quotes."
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

      <SaveBar id="zone-setup-save-bar" open={isDirty}>
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
