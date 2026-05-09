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
  FormLayout,
  Banner,
  BlockStack,
  Text,
} from "@shopify/polaris";
import { SaveBar } from "@shopify/app-bridge-react";
import { useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { parseLeadTimeField } from "../services/slot-leadtime.server";
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
    select: { id: true, leadTimeHours: true, leadTimeDays: true },
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
    const days = parseLeadTimeField(formData.get("leadTimeDays"));
    const hours = parseLeadTimeField(formData.get("leadTimeHours"));
    if (days != null && (days < 0 || days > 90)) {
      return json<ActionResult>(
        { ok: false, error: "Lead time in days must be between 0 and 90" },
        { status: 400 },
      );
    }
    if (hours != null && (hours < 0 || hours > 23)) {
      return json<ActionResult>(
        { ok: false, error: "Lead time in hours must be between 0 and 23" },
        { status: 400 },
      );
    }
    await prisma.location.update({
      where: { id },
      data: {
        leadTimeDays: days && days > 0 ? days : null,
        leadTimeHours: hours && hours > 0 ? hours : null,
      },
    });
    return redirect(`/app/locations/${id}/prep-time?saved=1`);
  } catch (error) {
    logger.error("Location prep-time save failed", error, { locationId: id });
    return json<ActionResult>(
      { ok: false, error: "Save failed. Please try again." },
      { status: 500 },
    );
  }
}

export default function LocationPrepTime() {
  const { location } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [searchParams, setSearchParams] = useSearchParams();
  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;
  const justSaved = searchParams.get("saved") === "1";

  const baselineFromLocation = () => ({
    days: location.leadTimeDays != null ? String(location.leadTimeDays) : "",
    hours: location.leadTimeHours != null ? String(location.leadTimeHours) : "",
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
  }, [justSaved, errorMessage, location.leadTimeDays, location.leadTimeHours]);

  const daysNum = parseFieldOrZero(values.days);
  const hoursNum = parseFieldOrZero(values.hours);
  const totalHours = daysNum * 24 + hoursNum;

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
            title="Prep time &amp; availability"
            description="Minimum lead time between an order being placed and the slot's start. The cart-block hides slots inside this window."
          >
            <Card>
              <BlockStack gap="400">
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Lead time (days)"
                      name="leadTimeDays"
                      value={values.days}
                      onChange={(v) => setField("days", v)}
                      type="number"
                      min={0}
                      max={90}
                      autoComplete="off"
                      helpText="Whole days, 0–90."
                      placeholder="0"
                    />
                    <TextField
                      label="Lead time (hours)"
                      name="leadTimeHours"
                      value={values.hours}
                      onChange={(v) => setField("hours", v)}
                      type="number"
                      min={0}
                      max={23}
                      autoComplete="off"
                      helpText="Additional hours, 0–23. Use the days field for ≥24 hours."
                      placeholder="0"
                    />
                  </FormLayout.Group>
                </FormLayout>
                <Text as="p" tone="subdued" variant="bodySm">
                  Effective lead time:{" "}
                  <strong>
                    {totalHours === 0
                      ? "none — all future slots are eligible"
                      : `${totalHours} hour${totalHours === 1 ? "" : "s"}`}
                  </strong>
                </Text>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </Form>

      <SaveBar id="location-prep-time-save-bar" open={isDirty}>
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

function parseFieldOrZero(s: string): number {
  const trimmed = s.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}
