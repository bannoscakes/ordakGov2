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
  DatePicker,
  Tag,
  Banner,
  BlockStack,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { SaveBar } from "@shopify/app-bridge-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { formatDateKey, parseDateStrings } from "../services/slot-blackout";
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
    select: { id: true, blackoutDates: true },
  });
  if (!location) throw new Response("Location not found", { status: 404 });

  return json({
    location: {
      id: location.id,
      blackoutDates: location.blackoutDates.map((d) => formatDateKey(d)),
    },
  });
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
    const raw = (formData.get("blackoutDates") as string | null) ?? "";
    const tokens = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const t of tokens) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        return json<ActionResult>(
          { ok: false, error: `"${t}" is not a valid YYYY-MM-DD date` },
          { status: 400 },
        );
      }
    }
    const blackoutDates = parseDateStrings(tokens);
    await prisma.location.update({
      where: { id },
      data: { blackoutDates },
    });
    return redirect(`/app/locations/${id}/block-dates?saved=1`);
  } catch (error) {
    logger.error("Location blackout-dates save failed", error, { locationId: id });
    return json<ActionResult>(
      { ok: false, error: "Save failed. Please try again." },
      { status: 500 },
    );
  }
}

export default function LocationBlockDates() {
  const { location } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [searchParams, setSearchParams] = useSearchParams();
  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;
  const justSaved = searchParams.get("saved") === "1";

  const [{ month, year }, setMonth] = useState(() => {
    const now = new Date();
    return { month: now.getMonth(), year: now.getFullYear() };
  });
  const [selectedDates, setSelectedDates] = useState<string[]>(location.blackoutDates);

  // Re-baseline selectedDates whenever the loader brings fresh data
  // (after save or external navigation).
  useEffect(() => {
    setSelectedDates(location.blackoutDates);
  }, [location.blackoutDates]);

  const disabledDates = useMemo(
    () => selectedDates.map((s) => new Date(`${s}T00:00:00.000Z`)),
    [selectedDates],
  );

  const handleDateChange = ({ end }: { start: Date; end: Date }) => {
    const key = formatDateKey(
      new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())),
    );
    setSelectedDates((prev) => (prev.includes(key) ? prev : [...prev, key].sort()));
  };

  const removeDate = (key: string) => {
    setSelectedDates((prev) => prev.filter((d) => d !== key));
  };

  const isDirty = !sameStringArray(selectedDates, location.blackoutDates);

  const formRef = useRef<HTMLFormElement>(null);
  const { showToast } = useToastFeedback();

  useEffect(() => {
    if (justSaved && !errorMessage) {
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
  }, [justSaved, errorMessage]);

  const onDiscard = () => setSelectedDates(location.blackoutDates);

  return (
    <>
      <Form method="post" ref={formRef}>
        <input type="hidden" name="blackoutDates" value={selectedDates.join(",")} />

        <Layout>
          {errorMessage && (
            <Layout.Section>
              <Banner tone="critical">{errorMessage}</Banner>
            </Layout.Section>
          )}

          <Layout.AnnotatedSection
            title="Block dates"
            description="Click a date to block it. The cart-block hides slots on blocked dates and the carrier-service returns no rates for orders that try to use them."
          >
            <Card>
              <DatePicker
                month={month}
                year={year}
                onMonthChange={(m, y) => setMonth({ month: m, year: y })}
                onChange={handleDateChange}
                disableSpecificDates={disabledDates}
                multiMonth
                allowRange={false}
              />
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Currently blocked"
            description={
              selectedDates.length === 0
                ? "No dates blocked yet."
                : `${selectedDates.length} date${selectedDates.length === 1 ? "" : "s"} blocked.`
            }
          >
            <Card>
              {selectedDates.length === 0 ? (
                <Text as="p" tone="subdued" variant="bodySm">
                  Click any date in the calendar above to block it.
                </Text>
              ) : (
                <InlineStack gap="200" wrap>
                  {selectedDates.map((d) => (
                    <Tag key={d} onRemove={() => removeDate(d)}>
                      {d}
                    </Tag>
                  ))}
                </InlineStack>
              )}
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </Form>

      <SaveBar id="location-block-dates-save-bar" open={isDirty}>
        <SaveBarButton
          variant="primary"
          onClick={() => formRef.current?.requestSubmit()}
          loading={isLoading}
        >
          Save
        </SaveBarButton>
        <SaveBarButton onClick={onDiscard} disabled={isLoading}>
          Discard
        </SaveBarButton>
      </SaveBar>
    </>
  );
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}
