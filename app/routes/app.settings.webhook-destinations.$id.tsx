import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Banner,
  Checkbox,
  TextField,
  InlineStack,
  Modal,
  Badge,
} from "@shopify/polaris";
import { SaveBar } from "@shopify/app-bridge-react";
import { useEffect, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { useDirtyForm } from "../components/useDirtyForm";
import { useToastFeedback } from "../components/useToastFeedback";
import { SaveBarButton } from "../components/SaveBarButton";

const KNOWN_EVENT_TYPES = [
  { value: "order.scheduled", label: "Order scheduled" },
  { value: "order.schedule_updated", label: "Order schedule updated" },
  { value: "order.schedule_canceled", label: "Order schedule canceled" },
  { value: "order.shopify_writes_attempted", label: "Order webhook write attempted" },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) throw new Response("Destination id required", { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    throw new Response("Shop not found — reinstall the app", { status: 404 });
  }
  const dest = await prisma.webhookDestination.findFirst({
    where: { id, shopId: shop.id },
  });
  if (!dest) {
    throw new Response("Webhook destination not found", { status: 404 });
  }
  return json({
    dest: {
      id: dest.id,
      url: dest.url,
      // Length-only hint — last-N reveal cuts brute-force search space and
      // the URL is the better identifier anyway. The merchant can rotate by
      // entering a new value (or blank → keep).
      secretLength: dest.secret.length,
      enabled: dest.enabled,
      eventTypes: dest.eventTypes,
      consecutiveFailures: dest.consecutiveFailures,
      lastSuccessAt: dest.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: dest.lastFailureAt?.toISOString() ?? null,
      lastError: dest.lastError,
      createdAt: dest.createdAt.toISOString(),
    },
  });
}

type ActionResult = { ok: true } | { ok: false; error: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) {
    return json<ActionResult>({ ok: false, error: "Destination id required" }, { status: 400 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json<ActionResult>({ ok: false, error: "Shop not found" }, { status: 404 });
  }

  try {
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "delete") {
      await prisma.webhookDestination.deleteMany({
        where: { id, shopId: shop.id },
      });
      return redirect("/app/settings/webhook-destinations");
    }

    if (intent === "save") {
      const url = ((formData.get("url") as string | null) || "").trim();
      const newSecret = ((formData.get("secret") as string | null) || "").trim();
      const enabled = formData.get("enabled") === "true";
      const eventTypes = ((formData.get("eventTypes") as string | null) || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (!url) {
        return json<ActionResult>({ ok: false, error: "URL is required" }, { status: 400 });
      }
      try {
        new URL(url);
      } catch {
        return json<ActionResult>({ ok: false, error: "URL is not a valid URL" }, { status: 400 });
      }
      if (newSecret && newSecret.length < 16) {
        return json<ActionResult>(
          { ok: false, error: "New secret must be at least 16 characters (or leave blank to keep the existing one)" },
          { status: 400 },
        );
      }

      // Multi-tenant scope — updateMany lets us filter by shopId without
      // declaring a compound unique constraint. count===0 means either the
      // row was deleted between load and save OR the merchant's session
      // doesn't own this destination.
      const updateData: { url: string; enabled: boolean; eventTypes: string[]; secret?: string } = {
        url,
        enabled,
        eventTypes,
      };
      if (newSecret) updateData.secret = newSecret;

      const updated = await prisma.webhookDestination.updateMany({
        where: { id, shopId: shop.id },
        data: updateData,
      });
      if (updated.count === 0) {
        return json<ActionResult>(
          { ok: false, error: "Destination no longer exists" },
          { status: 404 },
        );
      }
      return redirect(`/app/settings/webhook-destinations/${id}?saved=1`);
    }

    return json<ActionResult>({ ok: false, error: "Unknown intent" }, { status: 400 });
  } catch (error) {
    logger.error("Webhook destination update failed", error, { shop: session.shop, id });
    return json<ActionResult>({ ok: false, error: "Save failed. Please try again." }, { status: 500 });
  }
}

export default function EditWebhookDestination() {
  const { dest } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLoading = navigation.state === "submitting";

  // Initial form values — secret starts blank because the existing one
  // is opaque (length-only). Typing anything into secret => rotate.
  const initialValues = {
    url: dest.url,
    secret: "",
    enabled: dest.enabled,
    eventTypes: [...dest.eventTypes],
  };
  const { values, setField, isDirty, reset, rebaseline } = useDirtyForm(initialValues);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { showToast } = useToastFeedback();

  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;
  const justSaved = searchParams.get("saved") === "1";
  const justCreated = searchParams.get("created") === "1";

  // Re-baseline + toast after successful save (and strip ?saved so refreshes
  // don't replay the toast).
  useEffect(() => {
    if (justSaved && !errorMessage) {
      rebaseline({
        url: dest.url,
        secret: "",
        enabled: dest.enabled,
        eventTypes: [...dest.eventTypes],
      });
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
  }, [justSaved, errorMessage, dest.url, dest.enabled, dest.eventTypes, rebaseline, showToast, setSearchParams]);

  const toggleType = (value: string) => {
    setField(
      "eventTypes",
      values.eventTypes.includes(value)
        ? values.eventTypes.filter((v) => v !== value)
        : [...values.eventTypes, value],
    );
  };

  const onDelete = () => {
    const fd = new FormData();
    fd.append("intent", "delete");
    submit(fd, { method: "post" });
    setDeleteOpen(false);
  };

  const handleSave = () => {
    formRef.current?.requestSubmit();
  };

  const handleDiscard = () => {
    reset();
  };

  return (
    <Page
      title="Edit webhook destination"
      backAction={{ content: "Webhook destinations", url: "/app/settings/webhook-destinations" }}
      secondaryActions={[
        {
          content: "Delete",
          destructive: true,
          onAction: () => setDeleteOpen(true),
        },
      ]}
    >
      <Layout>
        {justCreated && (
          <Layout.Section>
            <Banner tone="success" title="Destination created">
              <p>
                Make sure your receiver is configured with the secret before flipping the
                enable toggle. The secret is shown masked once saved — keep a copy of it
                if you need it on the receiver side.
              </p>
            </Banner>
          </Layout.Section>
        )}
        {errorMessage && (
          <Layout.Section>
            <Banner tone="critical">{errorMessage}</Banner>
          </Layout.Section>
        )}

        {dest.consecutiveFailures > 0 && dest.lastError && (
          <Layout.Section>
            <Banner tone="warning" title={`${dest.consecutiveFailures} consecutive delivery failure${dest.consecutiveFailures === 1 ? "" : "s"}`}>
              <Text as="p" variant="bodySm">
                Last error: <code>{dest.lastError}</code>
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Last failure {dest.lastFailureAt ? new Date(dest.lastFailureAt).toLocaleString("en-AU") : "—"}.
                Fix the receiver — the counter resets on the next successful delivery.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        <Form method="post" ref={formRef}>
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="enabled" value={values.enabled.toString()} />
          <input type="hidden" name="eventTypes" value={values.eventTypes.join(",")} />

          <Layout.AnnotatedSection
            title="Receiver"
            description="Where Ordak Go POSTs events. Rotate the HMAC secret to invalidate the old signing key."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="URL"
                  name="url"
                  value={values.url}
                  onChange={(v) => setField("url", v)}
                  autoComplete="off"
                  requiredIndicator
                />
                <TextField
                  label="Rotate HMAC secret"
                  name="secret"
                  value={values.secret}
                  onChange={(v) => setField("secret", v)}
                  placeholder="Leave blank to keep existing secret"
                  helpText={`Existing secret is ${dest.secretLength} characters. Enter at least 16 characters to rotate; leave blank to keep the current value.`}
                  autoComplete="off"
                  type="password"
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Subscribed events"
            description="Empty list subscribes to every event the app emits."
          >
            <Card>
              <BlockStack gap="200">
                {KNOWN_EVENT_TYPES.map((t) => (
                  <Checkbox
                    key={t.value}
                    label={t.label}
                    helpText={t.value}
                    checked={values.eventTypes.includes(t.value)}
                    onChange={() => toggleType(t.value)}
                  />
                ))}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Activation"
            description="Disabled destinations skip dispatch but stay in the list for re-enable."
          >
            <Card>
              <Checkbox
                label="Enabled"
                helpText="Disabled destinations skip dispatch but stay in the list."
                checked={values.enabled}
                onChange={(checked) => setField("enabled", checked)}
              />
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Health"
            description="Delivery success and failure timestamps. Failures surface here, not silently in your downstream pipeline."
          >
            <Card>
              <BlockStack gap="200">
                <InlineStack gap="200" wrap>
                  <Badge tone={dest.consecutiveFailures === 0 ? "success" : dest.consecutiveFailures >= 3 ? "critical" : "warning"}>
                    {`${dest.consecutiveFailures} consecutive failure${dest.consecutiveFailures === 1 ? "" : "s"}`}
                  </Badge>
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  Last success: {dest.lastSuccessAt ? new Date(dest.lastSuccessAt).toLocaleString("en-AU") : "never"}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Last failure: {dest.lastFailureAt ? new Date(dest.lastFailureAt).toLocaleString("en-AU") : "never"}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Created: {new Date(dest.createdAt).toLocaleString("en-AU")}
                </Text>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Form>
      </Layout>

      <SaveBar id="webhook-destination-save-bar" open={isDirty}>
        <SaveBarButton variant="primary" onClick={handleSave} loading={isLoading}>
          Save
        </SaveBarButton>
        <SaveBarButton onClick={handleDiscard} disabled={isLoading}>
          Discard
        </SaveBarButton>
      </SaveBar>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete webhook destination"
        primaryAction={{ content: "Delete", destructive: true, onAction: onDelete }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">Delete the webhook destination at <code>{dest.url}</code>?</Text>
            <Text as="p" tone="critical">
              This cannot be undone. Future events won't be dispatched here. Your downstream
              system stops receiving notifications.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
