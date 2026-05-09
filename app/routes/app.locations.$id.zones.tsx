import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Layout,
  Card,
  DataTable,
  Badge,
  Button,
  EmptyState,
  BlockStack,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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
    select: {
      id: true,
      zones: {
        select: {
          id: true,
          name: true,
          type: true,
          postcodes: true,
          basePrice: true,
          isActive: true,
          priority: true,
          _count: { select: { slots: true } },
        },
        orderBy: { priority: "asc" },
      },
    },
  });
  if (!location) throw new Response("Location not found", { status: 404 });

  return json({
    location: {
      id: location.id,
      zones: location.zones.map((z) => ({
        ...z,
        basePrice: z.basePrice.toString(),
      })),
    },
  });
}

export default function LocationZones() {
  const { location } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const rows = location.zones.map((z) => [
    z.name,
    typeForLabel(z.type),
    `${z.postcodes.length} postcode${z.postcodes.length === 1 ? "" : "s"}`,
    `$${formatBasePrice(z.basePrice)} AUD`,
    `${z._count.slots} slot${z._count.slots === 1 ? "" : "s"}`,
    <Badge key={z.id} tone={z.isActive ? "success" : "critical"}>
      {z.isActive ? "Active" : "Inactive"}
    </Badge>,
    <Button key={z.id} size="slim" onClick={() => navigate(`/app/zones/${z.id}`)}>
      Edit
    </Button>,
  ]);

  return (
    <Layout>
      <Layout.AnnotatedSection
        title="Delivery zones"
        description="Zones define which postcodes this location delivers to and the base price. Each zone has its own time slots."
      >
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <Button
                variant="primary"
                onClick={() => navigate(`/app/zones/new?locationId=${location.id}`)}
              >
                Add zone
              </Button>
            </BlockStack>
          </Card>

          {location.zones.length === 0 ? (
            <Card>
              <EmptyState
                heading="No zones yet"
                action={{
                  content: "Add your first zone",
                  onAction: () => navigate(`/app/zones/new?locationId=${location.id}`),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Add a zone with the postcodes this location delivers to and a base delivery price.
                </p>
              </EmptyState>
            </Card>
          ) : (
            <Card padding="0">
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "text", "text", "text"]}
                headings={["Name", "Match", "Coverage", "Base price", "Slots", "Status", ""]}
                rows={rows}
              />
            </Card>
          )}
        </BlockStack>
      </Layout.AnnotatedSection>
    </Layout>
  );
}

function typeForLabel(t: string): string {
  if (t === "postcode_list") return "Postcode list";
  if (t === "postcode_range") return "Postcode range";
  if (t === "radius") return "Radius (km)";
  return t;
}

function formatBasePrice(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toFixed(2);
}

// LocationZones has no action — adding a zone navigates to /app/zones/new,
// editing navigates to /app/zones/:id. Delete lives on each zone detail
// page. No form on this route submits anywhere, so no action handler is
// needed.
