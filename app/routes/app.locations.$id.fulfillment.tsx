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
  Checkbox,
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
  if (!id) throw new Response("Location id required", { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const location = await prisma.location.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true, supportsDelivery: true, supportsPickup: true },
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
    await prisma.location.update({
      where: { id },
      data: {
        supportsDelivery: formData.get("supportsDelivery") === "true",
        supportsPickup: formData.get("supportsPickup") === "true",
      },
    });
    return redirect(`/app/locations/${id}/fulfillment?saved=1`);
  } catch (error) {
    logger.error("Location fulfillment save failed", error, { locationId: id });
    return json<ActionResult>(
      { ok: false, error: "Save failed. Please try again." },
      { status: 500 },
    );
  }
}

export default function LocationFulfillment() {
  const { location } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [searchParams, setSearchParams] = useSearchParams();
  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;
  const justSaved = searchParams.get("saved") === "1";

  const baselineFromLocation = () => ({
    supportsDelivery: location.supportsDelivery,
    supportsPickup: location.supportsPickup,
  });
  const { values, setField, isDirty, reset, rebaseline } = useDirtyForm(baselineFromLocation());

  const formRef = useRef<HTMLFormElement>(null);
  const { showToast } = useToastFeedback();

  // Heads-up shown only when the merchant *just* enabled pickup in this
  // form (it wasn't enabled when the page loaded). After save, the parent
  // layout's "needs pickup hours" banner takes over.
  const showPickupNudge = values.supportsPickup && !location.supportsPickup;

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
  }, [justSaved, errorMessage, location.supportsDelivery, location.supportsPickup]);

  return (
    <>
      <Form method="post" ref={formRef}>
        <input type="hidden" name="supportsDelivery" value={values.supportsDelivery.toString()} />
        <input type="hidden" name="supportsPickup" value={values.supportsPickup.toString()} />

        <Layout>
          {errorMessage && (
            <Layout.Section>
              <Banner tone="critical">{errorMessage}</Banner>
            </Layout.Section>
          )}

          <Layout.AnnotatedSection
            title="Fulfillment methods"
            description="Choose which methods this location offers. The cart-block shows the matching toggles to customers."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Local delivery"
                  checked={values.supportsDelivery}
                  onChange={(checked) => setField("supportsDelivery", checked)}
                  helpText="Orders dispatched from this location to a customer's address. Delivery hours are configured per zone."
                />
                <Checkbox
                  label="Store pickup"
                  checked={values.supportsPickup}
                  onChange={(checked) => setField("supportsPickup", checked)}
                  helpText="Customers collect orders from this location. Pickup hours are configured here on the location, not on a zone."
                />
                {showPickupNudge && (
                  <Banner tone="info">
                    After saving, you&apos;ll see a new <strong>Pickup hours</strong> tab. Set
                    the days and hours customers can collect, otherwise the cart-block will
                    show &quot;Pickup not available on this date&quot;.
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Minimum order value"
            description="Per-method minimums (e.g. $30 minimum for delivery)."
          >
            <Card>
              <Banner tone="info">
                Not yet wired. For now, set minimums via Shopify checkout rules or use the
                cart-block&apos;s minimum-cart-value setting in the theme editor.
              </Banner>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </Form>

      <SaveBar id="location-fulfillment-save-bar" open={isDirty}>
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
