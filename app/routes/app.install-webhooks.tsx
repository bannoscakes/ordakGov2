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

interface Status {
  ok: boolean;
  message: string;
  topics?: string[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  try {
    const result = await shopify.registerWebhooks({ session });
    // shopify.registerWebhooks returns an object keyed by topic with
    // `{ success, deliveryMethod }` per result. Surface a summary.
    const topics = Object.keys(result ?? {});
    return json<Status>({
      ok: true,
      message: `Re-registered ${topics.length} webhook subscription(s).`,
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
    <Page title="Re-register webhooks">
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
                    <Text as="p" key={t}>
                      • {t}
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
