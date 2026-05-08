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

// Parent layout for /app/zones/$id/* nested routes. Holds the shared
// chrome — Page wrapper, top tab nav, delete modal — and renders the
// active child via <Outlet />. Each child route owns its own loader,
// action, AnnotatedSection content, and SaveBar (for single-form
// children) or the SlotsEditor's per-day Save buttons (for the slots
// child). zones.$id was split during PR #6 to give each section its
// own SaveBar scope without inventing a per-section contextual-save
// hook.

const TABS = [
  { id: "setup", content: "Zone setup" },
  { id: "pricing", content: "Pricing" },
  { id: "slots", content: "Time slots & limits" },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) throw new Response("Zone id required", { status: 400 });

  // Backwards compat: pre-PR-6 URLs used ?section=setup|pricing|slots.
  // Redirect to the canonical nested route so old bookmarks and the
  // dashboard checklist links keep working.
  const url = new URL(request.url);
  const legacySection = url.searchParams.get("section");
  if (legacySection === "setup" || legacySection === "pricing" || legacySection === "slots") {
    const next = new URL(url);
    next.pathname = `/app/zones/${id}/${legacySection}`;
    next.searchParams.delete("section");
    throw redirect(next.pathname + next.search);
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const zone = await prisma.zone.findFirst({
    where: { id, shopId: shop.id },
    include: {
      location: { select: { id: true, name: true } },
      _count: { select: { slots: true } },
    },
  });
  if (!zone) throw new Response("Zone not found", { status: 404 });

  return json({
    zone: {
      id: zone.id,
      name: zone.name,
      location: zone.location,
      slotCount: zone._count.slots,
    },
  });
}

type ActionResult = { ok: true } | { ok: false; error: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) return json<ActionResult>({ ok: false, error: "Zone id required" }, { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return json<ActionResult>({ ok: false, error: "Shop not found" }, { status: 404 });

  const zone = await prisma.zone.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true, locationId: true },
  });
  if (!zone) return json<ActionResult>({ ok: false, error: "Zone not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  // The parent route only handles the cross-section "delete zone" action.
  // Save actions live on each child route alongside the form they save.
  if (intent === "delete") {
    try {
      await prisma.zone.delete({ where: { id } });
      return redirect(`/app/locations/${zone.locationId}?section=zones`);
    } catch (error) {
      logger.error("Zone delete failed", error, { zoneId: id });
      return json<ActionResult>(
        { ok: false, error: "Could not delete this zone. Please try again." },
        { status: 500 },
      );
    }
  }

  return json<ActionResult>({ ok: false, error: "Unknown intent" }, { status: 400 });
}

export default function ZoneAdminLayout() {
  const { zone } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const fromWizard = searchParams.get("from") === "wizard";

  // Derive the active tab from the URL path. Falls back to setup if the
  // path is /app/zones/$id with no nested segment (the index route
  // redirects to /setup, so this is just defensive).
  const activeTabId = (() => {
    const last = location.pathname.split("/").filter(Boolean).pop() ?? "";
    if (last === "setup" || last === "pricing" || last === "slots") return last;
    return "setup";
  })();
  const activeTabIndex = TABS.findIndex((t) => t.id === activeTabId);

  const onDelete = () => {
    const fd = new FormData();
    fd.append("intent", "delete");
    submit(fd, { method: "post" });
    setDeleteOpen(false);
  };

  return (
    <Page
      title={zone.name}
      subtitle={`Zone of ${zone.location.name}`}
      backAction={{
        content: "Back to location",
        url: `/app/locations/${zone.location.id}?section=zones`,
      }}
      secondaryActions={[
        { content: "Delete zone", destructive: true, onAction: () => setDeleteOpen(true) },
      ]}
    >
      <BlockStack gap="400">
        {fromWizard && (
          <Banner
            tone="info"
            title="Zone created — finish setup"
            action={{ content: "Back to dashboard", url: "/app" }}
          >
            <p>
              Set the base delivery price under <strong>Pricing</strong> and configure
              time slots under <strong>Time slots &amp; limits</strong>. The dashboard
              tracks your remaining setup steps.
            </p>
          </Banner>
        )}

        <Tabs
          tabs={TABS}
          selected={Math.max(activeTabIndex, 0)}
          onSelect={(idx) => navigate(`/app/zones/${zone.id}/${TABS[idx].id}`)}
        />

        <Outlet />
      </BlockStack>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete zone"
        primaryAction={{ content: "Delete", destructive: true, onAction: onDelete }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">Delete &quot;{zone.name}&quot;?</Text>
            {zone.slotCount > 0 && (
              <Banner tone="warning">
                This zone has {zone.slotCount} materialized slot(s). Deleting the zone removes them
                — bookings on those slots will be orphaned.
              </Banner>
            )}
            <Text as="p" tone="critical">This action cannot be undone.</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
