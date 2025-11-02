/**
 * Rules List Page
 * Display all scheduling rules (cut-off times, lead times, blackout dates, capacity)
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  Button,
  EmptyState,
  BlockStack,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const rules = await prisma.rule.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  const stats = {
    total: rules.length,
    active: rules.filter((r) => r.isActive).length,
    byType: {
      cutoff: rules.filter((r) => r.type === "cutoff").length,
      lead_time: rules.filter((r) => r.type === "lead_time").length,
      blackout: rules.filter((r) => r.type === "blackout").length,
      capacity: rules.filter((r) => r.type === "capacity").length,
    },
  };

  return json({ rules, stats });
}

function getRuleTypeBadge(type: string) {
  switch (type) {
    case "cutoff":
      return <Badge tone="attention">Cut-off Time</Badge>;
    case "lead_time":
      return <Badge tone="info">Lead Time</Badge>;
    case "blackout":
      return <Badge>Blackout Dates</Badge>;
    case "capacity":
      return <Badge tone="success">Capacity</Badge>;
    default:
      return <Badge>{type}</Badge>;
  }
}

function getRuleDetails(rule: any) {
  switch (rule.type) {
    case "cutoff":
      return rule.cutoffTime || "Not set";
    case "lead_time":
      const parts = [];
      if (rule.leadTimeDays) parts.push(`${rule.leadTimeDays} day${rule.leadTimeDays !== 1 ? "s" : ""}`);
      if (rule.leadTimeHours) parts.push(`${rule.leadTimeHours} hour${rule.leadTimeHours !== 1 ? "s" : ""}`);
      return parts.length > 0 ? parts.join(", ") : "Not set";
    case "blackout":
      const count = rule.blackoutDates?.length || 0;
      return `${count} date${count !== 1 ? "s" : ""}`;
    case "capacity":
      if (rule.slotDuration && rule.slotCapacity) {
        return `${rule.slotDuration} min slots, ${rule.slotCapacity} orders max`;
      }
      return "Not set";
    default:
      return "N/A";
  }
}

export default function RulesList() {
  const { rules, stats } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (rules.length === 0) {
    return (
      <Page title="Scheduling Rules">
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Configure your scheduling rules"
                action={{
                  content: "Add your first rule",
                  onAction: () => navigate("/app/rules/new"),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Create rules to control when customers can book slots. Set cut-off times,
                  lead times, blackout dates, and capacity limits.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const rows = rules.map((rule) => [
    rule.name,
    getRuleTypeBadge(rule.type),
    getRuleDetails(rule),
    rule.isActive ? (
      <Badge tone="success">Active</Badge>
    ) : (
      <Badge>Inactive</Badge>
    ),
    <Button
      onClick={() => navigate(`/app/rules/${rule.id}`)}
      variant="plain"
    >
      Edit
    </Button>,
  ]);

  return (
    <Page
      title="Scheduling Rules"
      primaryAction={{
        content: "Add Rule",
        onAction: () => navigate("/app/rules/new"),
      }}
    >
      <Layout>
        {/* Stats Cards */}
        <Layout.Section>
          <InlineStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Total Rules
                </Text>
                <Text as="p" variant="heading2xl">
                  {stats.total}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats.active} active
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  By Type
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd">
                    ⏰ Cut-off Times: {stats.byType.cutoff}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    📅 Lead Times: {stats.byType.lead_time}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    🚫 Blackout Dates: {stats.byType.blackout}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    📊 Capacity Rules: {stats.byType.capacity}
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </InlineStack>
        </Layout.Section>

        {/* Rules Table */}
        <Layout.Section>
          <Card padding="0">
            <DataTable
              columnContentTypes={[
                "text",
                "text",
                "text",
                "text",
                "text",
              ]}
              headings={[
                "Rule Name",
                "Type",
                "Details",
                "Status",
                "Actions",
              ]}
              rows={rows}
            />
          </Card>
        </Layout.Section>

        {/* Help Card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                About Scheduling Rules
              </Text>
              <Text as="p" variant="bodyMd">
                Scheduling rules control when customers can book delivery and pickup slots.
                You can create different types of rules:
              </Text>
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd">
                  • <strong>Cut-off Time:</strong> Latest time to order for same-day delivery (e.g., "Order by 2pm for today")
                </Text>
                <Text as="p" variant="bodyMd">
                  • <strong>Lead Time:</strong> Minimum advance notice required (e.g., "Must order 24 hours ahead")
                </Text>
                <Text as="p" variant="bodyMd">
                  • <strong>Blackout Dates:</strong> Days when no delivery/pickup is available (holidays, maintenance)
                </Text>
                <Text as="p" variant="bodyMd">
                  • <strong>Capacity:</strong> Define slot duration and maximum orders per slot
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
