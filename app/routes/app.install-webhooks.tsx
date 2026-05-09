// One-shot webhook (re)registration. Bridges the same gap as the carrier
// service / delivery customization installers: afterAuth fires on initial
// install but not on token-exchange refresh, so a freshly-added webhook
// subscription doesn't get registered for existing installs.
//
// Visiting this route calls shopify.registerWebhooks({ session }) which
// pushes whatever's declared in shopify.server.ts's `webhooks:` config to
// the live shop. Idempotent — Shopify's API skips topics already
// registered with the same callback URL.

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Banner } from "@shopify/polaris";
import shopify, { authenticate } from "../shopify.server";

interface TopicResult {
  topic: string;
  success: boolean;
  detail?: string;
}

interface Status {
  ok: boolean;
  message: string;
  topics?: TopicResult[];
}

interface RegisterResultEntry {
  success?: boolean;
  deliveryMethod?: string;
  result?: { errors?: Array<{ message?: string }> } | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  try {
    const result = (await shopify.registerWebhooks({ session })) as
      | Record<string, RegisterResultEntry | RegisterResultEntry[]>
      | undefined;

    const topics: TopicResult[] = [];
    for (const [topic, raw] of Object.entries(result ?? {})) {
      // Some SDK versions return an array per topic (one entry per
      // delivery method), others return a single object. Normalize.
      const entries = Array.isArray(raw) ? raw : [raw];
      for (const entry of entries) {
        const success = entry?.success !== false;
        const errs = entry?.result?.errors ?? [];
        topics.push({
          topic,
          success,
          detail: errs.length
            ? errs.map((e) => e?.message ?? "unknown").join("; ")
            : undefined,
        });
      }
    }

    const failures = topics.filter((t) => !t.success);
    return json<Status>({
      ok: failures.length === 0,
      message: failures.length
        ? `${failures.length} of ${topics.length} subscription(s) failed: ${failures
            .map((f) => `${f.topic} (${f.detail ?? "no detail"})`)
            .join("; ")}`
        : `Re-registered ${topics.length} webhook subscription(s).`,
      topics,
    });
  } catch (err) {
    let message = "unknown";
    if (err instanceof Response) {
      try {
        message = JSON.stringify(await err.json());
      } catch {
        message = `${err.status} ${err.statusText}`;
      }
    } else if (err instanceof Error) {
      message = err.message;
    }
    return json<Status>({ ok: false, message: `Register error: ${message}` });
  }
}

export default function InstallWebhooks() {
  const status = useLoaderData<typeof loader>();
  return (
    <Page title="Re-register webhooks" backAction={{ content: "Settings", url: "/app/settings" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Banner tone={status.ok ? "success" : "critical"}>
                <Text as="p">{status.message}</Text>
              </Banner>
              {status.topics?.length ? (
                <BlockStack gap="100">
                  {status.topics.map((t) => (
                    <Text as="p" key={`${t.topic}-${t.success}`}>
                      {t.success ? "✓" : "✗"} {t.topic}
                      {t.detail ? ` — ${t.detail}` : ""}
                    </Text>
                  ))}
                </BlockStack>
              ) : null}
              <Text as="p" tone="subdued">
                Pushes the webhook subscriptions declared in
                <code> shopify.server.ts </code>
                to this shop. Use after adding a new webhook topic to the
                config.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
