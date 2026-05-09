import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Banner,
  Button,
  Checkbox,
  TextField,
  FormLayout,
  InlineStack,
} from "@shopify/polaris";
import { useState } from "react";
import { randomBytes } from "node:crypto";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

const KNOWN_EVENT_TYPES = [
  { value: "order.scheduled", label: "Order scheduled" },
  { value: "order.schedule_updated", label: "Order schedule updated" },
  { value: "order.schedule_canceled", label: "Order schedule canceled" },
  { value: "order.shopify_writes_attempted", label: "Order webhook write attempted" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({});
}

type ActionResult = { ok: true } | { ok: false; error: string };

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  try {
    const formData = await request.formData();
    const url = ((formData.get("url") as string | null) || "").trim();
    const secretRaw = ((formData.get("secret") as string | null) || "").trim();
    const enabled = formData.get("enabled") === "true";
    const eventTypesRaw = (formData.get("eventTypes") as string | null) || "";
    const eventTypes = eventTypesRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);

    if (!url) {
      return json<ActionResult>({ ok: false, error: "URL is required" }, { status: 400 });
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return json<ActionResult>({ ok: false, error: "URL is not a valid URL" }, { status: 400 });
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return json<ActionResult>(
        { ok: false, error: "URL must start with https:// (or http:// for local testing)" },
        { status: 400 },
      );
    }

    const secret = secretRaw.length >= 16 ? secretRaw : generateSecret();

    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });
    if (!shop) {
      return json<ActionResult>({ ok: false, error: "Shop not found" }, { status: 404 });
    }

    const created = await prisma.webhookDestination.create({
      data: {
        shopId: shop.id,
        url,
        secret,
        enabled,
        eventTypes,
      },
    });
    return redirect(`/app/settings/webhook-destinations/${created.id}?created=1`);
  } catch (error) {
    logger.error("Webhook destination create failed", error, { shop: session.shop });
    return json<ActionResult>({ ok: false, error: "Save failed. Please try again." }, { status: 500 });
  }
}

export default function NewWebhookDestination() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;

  const toggleType = (value: string) => {
    setSelectedTypes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  return (
    <Page
      title="Add webhook destination"
      backAction={{ content: "Webhook destinations", url: "/app/settings/webhook-destinations" }}
    >
      <Layout>
        {errorMessage && (
          <Layout.Section>
            <Banner tone="critical">{errorMessage}</Banner>
          </Layout.Section>
        )}

        <Form method="post">
          <input type="hidden" name="enabled" value={enabled.toString()} />
          <input type="hidden" name="eventTypes" value={selectedTypes.join(",")} />

          <Layout.AnnotatedSection
            title="Receiver"
            description="Where Ordak Go POSTs events. Must accept POST and return 2xx on success."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="URL"
                  name="url"
                  value={url}
                  onChange={setUrl}
                  placeholder="https://your-server.example.com/ordak-events"
                  autoComplete="off"
                  requiredIndicator
                />
                <TextField
                  label="HMAC secret (optional)"
                  name="secret"
                  value={secret}
                  onChange={setSecret}
                  placeholder="Leave blank to auto-generate"
                  helpText="Signs the X-Ordak-Signature header. Auto-generated if left blank. Must be at least 16 characters."
                  autoComplete="off"
                  type="password"
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Subscribed events"
            description="Leave all unchecked to subscribe to every event the app emits."
          >
            <Card>
              <BlockStack gap="200">
                {KNOWN_EVENT_TYPES.map((t) => (
                  <Checkbox
                    key={t.value}
                    label={t.label}
                    helpText={t.value}
                    checked={selectedTypes.includes(t.value)}
                    onChange={() => toggleType(t.value)}
                  />
                ))}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Activation"
            description="Off by default. Flip on once the receiving end is configured."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Enable immediately"
                  helpText="Disabled destinations skip dispatch."
                  checked={enabled}
                  onChange={setEnabled}
                />
                <InlineStack align="end">
                  <Button variant="primary" submit loading={isLoading}>
                    Create destination
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
