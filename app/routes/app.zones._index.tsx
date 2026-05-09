/**
 * Zone List Page
 * Display all service zones with their coverage areas
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
  Icon,
} from "@shopify/polaris";
import {
  NoteIcon,
  ChartVerticalIcon,
  TargetIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const zones = await prisma.zone.findMany({
    where: { shopId: shop.id },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          city: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const stats = {
    total: zones.length,
    active: zones.filter((z) => z.isActive).length,
    byType: {
      postcode_list: zones.filter((z) => z.type === "postcode_list").length,
      postcode_range: zones.filter((z) => z.type === "postcode_range").length,
      radius: zones.filter((z) => z.type === "radius").length,
    },
  };

  return json({ zones, stats });
}

function getZoneTypeBadge(type: string) {
  switch (type) {
    case "postcode_list":
      return <Badge>Postcode List</Badge>;
    case "postcode_range":
      return <Badge>Postcode Range</Badge>;
    case "radius":
      return <Badge tone="info">Radius</Badge>;
    default:
      return <Badge>{type}</Badge>;
  }
}

function getZoneCoverage(zone: any) {
  switch (zone.type) {
    case "postcode_list":
      const count = zone.postcodes?.length || 0;
      return `${count} postcode${count !== 1 ? "s" : ""}`;
    case "postcode_range":
      if (zone.postcodes && zone.postcodes.length >= 2) {
        return `${zone.postcodes[0]} - ${zone.postcodes[1]}`;
      }
      return "Range not set";
    case "radius":
      return zone.radiusKm ? `${zone.radiusKm}km radius` : "Radius not set";
    default:
      return "N/A";
  }
}

export default function ZonesList() {
  const { zones, stats } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (zones.length === 0) {
    return (
      <Page title="Service Zones">
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Define your service zones"
                action={{
                  content: "Add your first zone",
                  onAction: () => navigate("/app/zones/new"),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Create service zones to define where you offer delivery and pickup.
                  You can use postcode lists, ranges, or radius-based zones.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const rows = zones.map((zone) => [
    zone.name,
    zone.location.name,
    getZoneTypeBadge(zone.type),
    getZoneCoverage(zone),
    zone.isActive ? (
      <Badge tone="success">Active</Badge>
    ) : (
      <Badge>Inactive</Badge>
    ),
    <Button
      onClick={() => navigate(`/app/zones/${zone.id}`)}
      variant="plain"
    >
      Edit
    </Button>,
  ]);

  return (
    <Page
      title="Service Zones"
      primaryAction={{
        content: "Add zone",
        onAction: () => navigate("/app/zones/new"),
      }}
    >
      <Layout>
        {/* Stats Cards */}
        <Layout.Section>
          <InlineStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Total Zones
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
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={NoteIcon} tone="base" />
                    <Text as="p" variant="bodyMd">
                      Postcode Lists: {stats.byType.postcode_list}
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={ChartVerticalIcon} tone="base" />
                    <Text as="p" variant="bodyMd">
                      Postcode Ranges: {stats.byType.postcode_range}
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={TargetIcon} tone="base" />
                    <Text as="p" variant="bodyMd">
                      Radius Zones: {stats.byType.radius}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </InlineStack>
        </Layout.Section>

        {/* Zones Table */}
        <Layout.Section>
          <Card padding="0">
            <DataTable
              columnContentTypes={[
                "text",
                "text",
                "text",
                "text",
                "text",
                "text",
              ]}
              headings={[
                "Zone Name",
                "Location",
                "Type",
                "Coverage",
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
                About Service Zones
              </Text>
              <Text as="p" variant="bodyMd">
                Service zones define where you offer delivery and pickup services.
                Each zone is linked to a location and uses one of three methods:
              </Text>
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd">
                  • <strong>Postcode List:</strong> Specific postcodes (e.g., 2000, 2001, 2010)
                </Text>
                <Text as="p" variant="bodyMd">
                  • <strong>Postcode Range:</strong> Range of postcodes (e.g., 2000-2100)
                </Text>
                <Text as="p" variant="bodyMd">
                  • <strong>Radius:</strong> Distance from location (e.g., 10km radius)
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
