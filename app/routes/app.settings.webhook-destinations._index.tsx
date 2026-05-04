import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  EmptyState,
  DataTable,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      id: true,
      webhookDestinations: {
        select: {
          id: true,
          url: true,
          enabled: true,
          eventTypes: true,
          consecutiveFailures: true,
          lastSuccessAt: true,
          lastFailureAt: true,
          lastError: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!shop) {
    throw new Response("Shop not found — reinstall the app", { status: 404 });
  }
  return json({
    destinations: shop.webhookDestinations.map((d) => ({
      ...d,
      lastSuccessAt: d.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: d.lastFailureAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    })),
  });
}

function HealthBadge({
  consecutiveFailures,
  lastSuccessAt,
  lastFailureAt,
}: {
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}) {
  if (!lastSuccessAt && !lastFailureAt) {
    return <Badge>Untested</Badge>;
  }
  if (consecutiveFailures >= 3) {
    return <Badge tone="critical">{`Failing (${consecutiveFailures})`}</Badge>;
  }
  if (consecutiveFailures > 0) {
    return <Badge tone="warning">{`${consecutiveFailures} recent failure${consecutiveFailures === 1 ? "" : "s"}`}</Badge>;
  }
  return <Badge tone="success">Healthy</Badge>;
}

export default function WebhookDestinationsIndex() {
  const { destinations } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (destinations.length === 0) {
    return (
      <Page
        title="Webhook destinations"
        backAction={{ content: "Settings", url: "/app/settings/integrations" }}
        primaryAction={{ content: "Add destination", onAction: () => navigate("/app/settings/webhook-destinations/new") }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="No webhook destinations yet"
                action={{
                  content: "Add destination",
                  onAction: () => navigate("/app/settings/webhook-destinations/new"),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Forward order/scheduling events to external systems — your delivery routing
                  platform, ERP, manufacturing pipeline, etc. Each destination receives signed
                  POST requests on every matching event.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const rows = destinations.map((d) => [
    <span key={`url-${d.id}`} style={{ fontFamily: "monospace", fontSize: 12 }}>
      {d.url}
    </span>,
    <Badge key={`enabled-${d.id}`} tone={d.enabled ? "success" : undefined}>
      {d.enabled ? "Enabled" : "Disabled"}
    </Badge>,
    d.eventTypes.length === 0 ? "All events" : `${d.eventTypes.length} event type${d.eventTypes.length === 1 ? "" : "s"}`,
    <HealthBadge
      key={`health-${d.id}`}
      consecutiveFailures={d.consecutiveFailures}
      lastSuccessAt={d.lastSuccessAt}
      lastFailureAt={d.lastFailureAt}
    />,
    d.lastSuccessAt
      ? new Date(d.lastSuccessAt).toLocaleString("en-AU")
      : d.lastFailureAt
        ? `Last failure ${new Date(d.lastFailureAt).toLocaleString("en-AU")}`
        : "—",
    <Button key={`edit-${d.id}`} size="slim" onClick={() => navigate(`/app/settings/webhook-destinations/${d.id}`)}>
      Edit
    </Button>,
  ]);

  return (
    <Page
      title="Webhook destinations"
      backAction={{ content: "Settings", url: "/app/settings/integrations" }}
      primaryAction={{
        content: "Add destination",
        onAction: () => navigate("/app/settings/webhook-destinations/new"),
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="p" tone="subdued" variant="bodySm">
                Each destination receives signed POST requests with the event payload. Sign
                verification: <code>X-Ordak-Signature</code> header carries
                <code>sha256=&lt;hex&gt;</code> of the request body, computed with the
                destination's secret. Failing destinations surface here with a count.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text", "text"]}
              headings={["URL", "Status", "Subscribed", "Health", "Last delivery", ""]}
              rows={rows}
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
