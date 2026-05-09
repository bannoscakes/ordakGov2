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
  Banner,
  BlockStack,
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
    select: { id: true, basePrice: true, excludePostcodes: true },
  });
  if (!zone) throw new Response("Zone not found", { status: 404 });

  return json({
    zone: {
      id: zone.id,
      basePrice: zone.basePrice.toString(),
      excludePostcodes: zone.excludePostcodes,
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
    select: { id: true },
  });
  if (!zone) return json<ActionResult>({ ok: false, error: "Zone not found" }, { status: 404 });

  try {
    const formData = await request.formData();
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
    return redirect(`/app/zones/${id}/pricing?saved=1`);
  } catch (error) {
    logger.error("Zone pricing save failed", error, { zoneId: id });
    return json<ActionResult>(
      { ok: false, error: "Save failed. Please try again." },
      { status: 500 },
    );
  }
}

export default function ZonePricing() {
  const { zone } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [searchParams, setSearchParams] = useSearchParams();
  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;
  const justSaved = searchParams.get("saved") === "1";

  const baselineFromZone = () => ({
    basePrice: zone.basePrice,
    excludePostcodes: zone.excludePostcodes.join(", "),
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
  }, [justSaved, errorMessage, zone.basePrice, zone.excludePostcodes]);

  return (
    <>
      <Form method="post" ref={formRef}>
        <Layout>
          {errorMessage && (
            <Layout.Section>
              <Banner tone="critical">{errorMessage}</Banner>
            </Layout.Section>
          )}

          <Layout.AnnotatedSection
            title="Delivery pricing"
            description="Base delivery charge for orders in this zone. Time slots can add a per-slot premium on top."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Base delivery price (AUD)"
                  name="basePrice"
                  value={values.basePrice}
                  onChange={(v) => setField("basePrice", v)}
                  type="number"
                  step={0.01}
                  min={0}
                  prefix="$"
                  autoComplete="off"
                  requiredIndicator
                  helpText="Customer pays this plus the selected slot's price adjustment."
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Exclude postcodes"
            description='Postcodes inside the zone you don&apos;t deliver to. Useful for "all of inner Sydney except these specific suburbs."'
          >
            <Card>
              <TextField
                label="Exclude postcodes"
                name="excludePostcodes"
                value={values.excludePostcodes}
                onChange={(v) => setField("excludePostcodes", v)}
                placeholder="e.g., 2099, 2100"
                multiline={2}
                autoComplete="off"
                helpText="Separate with commas. Leave blank for none."
              />
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </Form>

      <SaveBar id="zone-pricing-save-bar" open={isDirty}>
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
