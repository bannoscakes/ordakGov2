/**
 * Locations Index Page
 * Lists all locations with ability to add, edit, delete
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Button,
  Badge,
  EmptyState,
  InlineStack,
  Text,
  Icon,
} from "@shopify/polaris";
import { PlusIcon, EditIcon, DeleteIcon } from "@shopify/polaris-icons";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { useState } from "react";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  // Get shop
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  // Get all locations for this shop
  const locations = await prisma.location.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          slots: true,
          zones: true,
        },
      },
    },
  });

  return json({ locations });
}

export default function LocationsIndex() {
  const { locations } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);

  const rows = locations.map((location) => [
    location.name,
    location.city || "-",
    location.postalCode || "-",
    <InlineStack gap="200" key={location.id}>
      {location.supportsDelivery && <Badge tone="info">Delivery</Badge>}
      {location.supportsPickup && <Badge tone="success">Pickup</Badge>}
    </InlineStack>,
    <Badge tone={location.isActive ? "success" : "critical"} key={location.id}>
      {location.isActive ? "Active" : "Inactive"}
    </Badge>,
    <InlineStack gap="200" key={location.id}>
      <Text as="span" tone="subdued">
        {location._count.zones} zones
      </Text>
      <Text as="span" tone="subdued">
        {location._count.slots} slots
      </Text>
    </InlineStack>,
    <InlineStack gap="200" key={location.id}>
      <Button
        size="slim"
        onClick={() => navigate(`/app/locations/${location.id}`)}
        icon={EditIcon}
      >
        Edit
      </Button>
    </InlineStack>,
  ]);

  return (
    <Page
      title="Locations"
      primaryAction={{
        content: "Add Location",
        icon: PlusIcon,
        onAction: () => navigate("/app/locations/new"),
      }}
      backAction={{ content: "Settings", url: "/app" }}
    >
      <Layout>
        {locations.length === 0 ? (
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Add your first location"
                action={{
                  content: "Add Location",
                  onAction: () => navigate("/app/locations/new"),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Locations are pickup points or delivery hubs where customers can
                  collect orders or where deliveries are dispatched from.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        ) : (
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
                  "text",
                ]}
                headings={[
                  "Name",
                  "City",
                  "Postal Code",
                  "Services",
                  "Status",
                  "Usage",
                  "Actions",
                ]}
                rows={rows}
                hoverable
              />
            </Card>
          </Layout.Section>
        )}

        <Layout.Section variant="oneThird">
          <Card>
            <Text as="h2" variant="headingMd">
              About Locations
            </Text>
            <div style={{ marginTop: "12px" }}>
              <Text as="p" tone="subdued">
                Locations are physical places where:
              </Text>
              <ul style={{ marginTop: "8px", paddingLeft: "20px" }}>
                <li>
                  <Text as="span" tone="subdued">
                    Customers can pick up orders
                  </Text>
                </li>
                <li>
                  <Text as="span" tone="subdued">
                    Deliveries are dispatched from
                  </Text>
                </li>
              </ul>
              <div style={{ marginTop: "12px" }}>
                <Text as="p" tone="subdued">
                  Each location can have its own delivery zones, time slots, and
                  scheduling rules.
                </Text>
              </div>
            </div>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <Text as="h2" variant="headingMd">
              Quick Stats
            </Text>
            <div style={{ marginTop: "12px" }}>
              <Text as="p">
                <strong>{locations.length}</strong> total locations
              </Text>
              <Text as="p">
                <strong>{locations.filter((l) => l.isActive).length}</strong>{" "}
                active
              </Text>
              <Text as="p">
                <strong>
                  {locations.reduce((sum, l) => sum + l._count.zones, 0)}
                </strong>{" "}
                delivery zones
              </Text>
              <Text as="p">
                <strong>
                  {locations.reduce((sum, l) => sum + l._count.slots, 0)}
                </strong>{" "}
                time slots
              </Text>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
