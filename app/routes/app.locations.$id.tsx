import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import {
  Page,
  Banner,
  BlockStack,
  Modal,
  Tabs,
  Text,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

// Parent layout for /app/locations/$id/* nested routes. Holds the
// shared chrome — Page wrapper, top tab nav, cross-cutting "pickup
// needs hours" warning, delete modal — and renders the active child
// via <Outlet />. Each child route owns its own loader, action, and
// SaveBar (for single-form children) or SlotsEditor's per-day Save
// buttons (pickup-hours).
//
// locations.$id was split during PR #6b to give each section its own
// SaveBar scope without inventing a per-section contextual-save hook.
// PR 6a applied the same pattern to zones.$id.

const BASE_TABS = [
  { id: "setup", content: "Location setup" },
  { id: "fulfillment", content: "Fulfillment type" },
  { id: "prep-time", content: "Prep time & availability" },
  { id: "block-dates", content: "Block dates" },
  { id: "zones", content: "Zones" },
];

const PICKUP_HOURS_TAB = { id: "pickup-hours", content: "Pickup hours" };

const VALID_TAB_IDS = new Set([
  "setup",
  "fulfillment",
  "prep-time",
  "block-dates",
  "zones",
  "pickup-hours",
]);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) throw new Response("Location id required", { status: 400 });

  // Backwards compat: pre-PR-6b URLs used ?section=...
  // Redirect to the canonical nested route so old bookmarks (notably
  // the dashboard checklist's pickup-hours link) keep working.
  const url = new URL(request.url);
  const legacySection = url.searchParams.get("section");
  if (legacySection && VALID_TAB_IDS.has(legacySection)) {
    const next = new URL(url);
    next.pathname = `/app/locations/${id}/${legacySection}`;
    next.searchParams.delete("section");
    throw redirect(next.pathname + next.search);
  }

  // Default landing for /app/locations/$id with no nested segment → /setup.
  // Inlined here rather than via an _index child so the parent's delete
  // action stays reachable (per the PR 6a fix — _index would shadow the
  // parent at the same URL under Remix's deepest-match rule).
  if (
    url.pathname === `/app/locations/${id}` ||
    url.pathname === `/app/locations/${id}/`
  ) {
    throw redirect(`/app/locations/${id}/setup${url.search}`);
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const location = await prisma.location.findFirst({
    where: { id, shopId: shop.id },
    select: {
      id: true,
      name: true,
      supportsPickup: true,
      _count: { select: { slots: true, zones: true } },
    },
  });
  if (!location) throw new Response("Location not found", { status: 404 });

  // Misconfiguration the merchant should see no matter which tab they're on:
  // they checked Supports pickup but never told us when pickup is available,
  // so the cart-block has nothing to offer customers.
  let pickupTemplateCount = 0;
  if (location.supportsPickup) {
    pickupTemplateCount = await prisma.slotTemplate.count({
      where: { locationId: id, fulfillmentType: "pickup", isActive: true },
    });
  }

  return json({
    location: {
      id: location.id,
      name: location.name,
      supportsPickup: location.supportsPickup,
      slotCount: location._count.slots,
      zoneCount: location._count.zones,
    },
    pickupTemplateCount,
  });
}

type ActionResult = { ok: true } | { ok: false; error: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) {
    return json<ActionResult>({ ok: false, error: "Location id required" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json<ActionResult>({ ok: false, error: "Shop not found" }, { status: 404 });
  }

  const location = await prisma.location.findFirst({
    where: { id, shopId: shop.id },
    include: { _count: { select: { slots: true, zones: true } } },
  });
  if (!location) {
    return json<ActionResult>({ ok: false, error: "Location not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  // Parent only handles the cross-section "delete location" action. Save
  // actions live on the child route alongside the form they save.
  if (intent === "delete") {
    if (location._count.slots > 0 || location._count.zones > 0) {
      return json<ActionResult>(
        {
          ok: false,
          error: `Cannot delete: ${location._count.slots} slot(s) and ${location._count.zones} zone(s) attached. Remove them first.`,
        },
        { status: 400 },
      );
    }
    try {
      await prisma.location.delete({ where: { id } });
      return redirect("/app/locations");
    } catch (error) {
      logger.error("Location delete failed", error, { locationId: id });
      return json<ActionResult>(
        { ok: false, error: "Could not delete this location. Please try again." },
        { status: 500 },
      );
    }
  }

  return json<ActionResult>({ ok: false, error: "Unknown intent" }, { status: 400 });
}

export default function LocationAdminLayout() {
  const { location, pickupTemplateCount } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const [searchParams] = useSearchParams();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const fromWizard = searchParams.get("from") === "wizard";

  // Pickup hours tab only appears when the location actually does pickup.
  // Hiding it for delivery-only locations keeps the sidebar focused on
  // relevant config.
  const tabs = location.supportsPickup
    ? [...BASE_TABS.slice(0, 2), PICKUP_HOURS_TAB, ...BASE_TABS.slice(2)]
    : BASE_TABS;

  const activeTabId = (() => {
    const last = routeLocation.pathname.split("/").filter(Boolean).pop() ?? "";
    return VALID_TAB_IDS.has(last) ? last : "setup";
  })();
  const activeTabIndex = tabs.findIndex((t) => t.id === activeTabId);

  const pickupNeedsHours = location.supportsPickup && pickupTemplateCount === 0;
  const onPickupHoursTab = activeTabId === "pickup-hours";

  const onDelete = () => {
    const fd = new FormData();
    fd.append("intent", "delete");
    submit(fd, { method: "post", action: `/app/locations/${location.id}` });
    setDeleteModalOpen(false);
  };

  return (
    <Page
      title={location.name}
      backAction={{ content: "Locations", url: "/app/locations" }}
      secondaryActions={[
        {
          content: "Delete location",
          destructive: true,
          onAction: () => setDeleteModalOpen(true),
        },
      ]}
    >
      <BlockStack gap="400">
        {fromWizard && (
          <Banner
            tone="info"
            title="Location created — finish setup"
            action={{ content: "Back to dashboard", url: "/app" }}
          >
            <p>
              Configure delivery zones, pickup hours, and lead time using the tabs below.
              The dashboard tracks your remaining setup steps.
            </p>
          </Banner>
        )}

        {pickupNeedsHours && !onPickupHoursTab && (
          <Banner
            tone="warning"
            title="Pickup is enabled but has no hours configured"
            action={{
              content: "Configure pickup hours",
              url: `/app/locations/${location.id}/pickup-hours`,
            }}
          >
            <p>
              Customers can&apos;t book pickup until you set hours. Either configure pickup
              hours or uncheck &quot;Supports pickup&quot; on the Fulfillment type tab.
            </p>
          </Banner>
        )}

        <Tabs
          tabs={tabs}
          selected={Math.max(activeTabIndex, 0)}
          onSelect={(idx) => navigate(`/app/locations/${location.id}/${tabs[idx].id}`)}
        />

        <Outlet />
      </BlockStack>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete location"
        primaryAction={{ content: "Delete", destructive: true, onAction: onDelete }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">Delete &quot;{location.name}&quot;?</Text>
            {(location.slotCount > 0 || location.zoneCount > 0) && (
              <Banner tone="warning">
                This location has {location.slotCount} slot(s) and {location.zoneCount} zone(s)
                attached. Remove them first — the action will fail otherwise.
              </Banner>
            )}
            <Text as="p" tone="critical">This action cannot be undone.</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
