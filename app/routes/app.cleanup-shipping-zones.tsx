// Removes a stale manual "Standard delivery" rate from the AU shipping
// zone on shops that were set up with the old version of
// /app/setup-au-shipping (which used to create a $15 manual delivery
// rate). Delivery pricing is now served by the Carrier Service callback
// (zone.basePrice + slot.priceAdjustment), so any leftover manual rate
// competes with our dynamic rate at checkout — and on installs where
// the C.5 Function isn't active (non-Plus + custom-app), the manual
// rate leaks to customers.
//
// Pickup at Annandale $0 stays — that's a benign fallback for the
// carrier service's $0 pickup rate.
//
// SECURITY: destructive write lives in `action`, not `loader`. Loader
// returns the current state for the form to render.

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Banner,
  Button,
  List,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

interface MethodDef {
  id: string;
  name: string;
}

interface CurrentState {
  hasAuZone: boolean;
  zoneName: string | null;
  manualStandardDeliveryIds: string[];
  manualStandardDeliveryNames: string[];
  hasPickupRate: boolean;
}

interface Status {
  ok: boolean;
  steps: string[];
  error?: string;
  removedCount?: number;
}

interface DeliveryProfile {
  id: string;
  default: boolean;
  profileLocationGroups?: Array<{
    locationGroup: { id: string };
    locationGroupZones: {
      nodes: Array<{
        zone: { id: string; name: string };
        methodDefinitions: { nodes: Array<MethodDef> };
      }>;
    };
  }>;
}

const PROFILE_QUERY = `#graphql
  query OrdakGoCleanupProfiles {
    deliveryProfiles(first: 5) {
      nodes {
        id
        default
        profileLocationGroups {
          locationGroup { id }
          locationGroupZones(first: 10) {
            nodes {
              zone { id name }
              methodDefinitions(first: 25) { nodes { id name } }
            }
          }
        }
      }
    }
  }
`;

function pickProfile(body: { data?: { deliveryProfiles?: { nodes?: DeliveryProfile[] } } }): DeliveryProfile | null {
  const nodes = body.data?.deliveryProfiles?.nodes ?? [];
  return nodes.find((p) => p.default) ?? nodes[0] ?? null;
}

// Identifies the manual Standard delivery rate by name. We deliberately
// don't match on `delivery` alone because our carrier service's
// service_name is "Standard delivery" — that's a CARRIER rate definition
// not a manual rate definition, lives elsewhere, and matching by name
// here only inspects manual rates from `methodDefinitions`. Carrier-rate
// definitions don't appear in this list.
//
// Word-boundary regex so we don't false-match "Standardized delivery",
// "Premium standard", "Standard pickup" (also excluded by the explicit
// pickup check), etc. The merchant could create a rate called e.g.
// "Standard express" and not want it removed — that has no
// "delivery" word, so this regex won't match it.
const MANUAL_STANDARD_DELIVERY_PATTERN = /\bstandard\s+delivery\b/i;

function isManualStandardDelivery(name: string): boolean {
  if (/pickup/i.test(name)) return false;
  return MANUAL_STANDARD_DELIVERY_PATTERN.test(name);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const profilesRes = await admin.graphql(PROFILE_QUERY);
  const profilesBody = await profilesRes.json();
  const profile = pickProfile(profilesBody);

  const auZoneEntry = profile?.profileLocationGroups
    ?.flatMap((g) => g.locationGroupZones.nodes)
    ?.find((z) => /australia/i.test(z.zone.name));
  const methods = auZoneEntry?.methodDefinitions?.nodes ?? [];
  const manualStandardDelivery = methods.filter((m) => isManualStandardDelivery(m.name));

  return json<CurrentState>({
    hasAuZone: !!auZoneEntry,
    zoneName: auZoneEntry?.zone.name ?? null,
    manualStandardDeliveryIds: manualStandardDelivery.map((m) => m.id),
    manualStandardDeliveryNames: manualStandardDelivery.map((m) => m.name),
    hasPickupRate: methods.some((m) => /pickup/i.test(m.name)),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const steps: string[] = [];

  try {
    const profilesRes = await admin.graphql(PROFILE_QUERY);
    const profilesBody = await profilesRes.json();
    const profile = pickProfile(profilesBody);
    if (!profile) {
      return json<Status>({ ok: false, steps, error: "No delivery profile found" });
    }
    steps.push(`Found delivery profile: ${profile.id}`);

    const auGroupZone = profile.profileLocationGroups
      ?.map((g) => ({
        locationGroupId: g.locationGroup.id,
        zone: g.locationGroupZones.nodes.find((z) => /australia/i.test(z.zone.name)),
      }))
      .find((entry) => entry.zone);

    if (!auGroupZone?.zone) {
      return json<Status>({
        ok: true,
        steps: [...steps, "No AU shipping zone found — nothing to clean up."],
        removedCount: 0,
      });
    }

    const standardDeliveryMethods = auGroupZone.zone.methodDefinitions.nodes.filter((m) =>
      isManualStandardDelivery(m.name),
    );

    if (standardDeliveryMethods.length === 0) {
      return json<Status>({
        ok: true,
        steps: [
          ...steps,
          "AU zone has no manual Standard delivery rate — already clean.",
        ],
        removedCount: 0,
      });
    }

    steps.push(
      `Found ${standardDeliveryMethods.length} manual Standard delivery rate(s) to remove: ${standardDeliveryMethods.map((m) => `"${m.name}"`).join(", ")}`,
    );

    // `methodDefinitionsToDelete` lives at the top level of
    // DeliveryProfileInput, not nested inside zonesToUpdate. The IDs
    // are globally unique and Shopify resolves the parent zone
    // automatically (same pattern as zonesToDelete and conditionsToDelete).
    // Earlier draft of this code nested it under zonesToUpdate; that
    // was rejected by code review (PR #72) as silently-ignored or
    // schema-validation-error. Verified against
    // shopify.dev/docs/api/admin-graphql/latest/input-objects/DeliveryProfileInput.
    const updateRes = await admin.graphql(
      `#graphql
        mutation OrdakGoRemoveManualDelivery($id: ID!, $profile: DeliveryProfileInput!) {
          deliveryProfileUpdate(id: $id, profile: $profile) {
            profile { id }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          id: profile.id,
          profile: {
            methodDefinitionsToDelete: standardDeliveryMethods.map((m) => m.id),
          },
        },
      },
    );
    const updateBody = await updateRes.json();
    const errs = updateBody.data?.deliveryProfileUpdate?.userErrors ?? [];
    if (errs.length) {
      return json<Status>({
        ok: false,
        steps,
        error: `Remove failed: ${errs.map((e: { field: string[]; message: string }) => `${e.field?.join(".")}: ${e.message}`).join(", ")}`,
      });
    }

    steps.push(
      `Removed ${standardDeliveryMethods.length} manual Standard delivery rate(s). Carrier service is now the only source of delivery pricing at checkout.`,
    );
    return json<Status>({
      ok: true,
      steps,
      removedCount: standardDeliveryMethods.length,
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
    return json<Status>({ ok: false, steps, error: message });
  }
}

export default function CleanupShippingZones() {
  const state = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const hasManualToRemove = state.manualStandardDeliveryIds.length > 0;
  const alreadyClean = state.hasAuZone && !hasManualToRemove;

  return (
    <Page title="Cleanup shipping zones" backAction={{ content: "Settings", url: "/app/settings" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Current state
              </Text>
              <List type="bullet">
                <List.Item>
                  Australia zone: {state.zoneName ?? "none"} {state.hasAuZone ? "✓" : "✗"}
                </List.Item>
                <List.Item>
                  Pickup rate present: {state.hasPickupRate ? "✓" : "✗"}
                </List.Item>
                <List.Item>
                  Manual Standard delivery rate(s) to remove:{" "}
                  {state.manualStandardDeliveryNames.length === 0
                    ? "none ✓"
                    : state.manualStandardDeliveryNames.join(", ")}
                </List.Item>
              </List>
              {alreadyClean ? (
                <Banner tone="success">
                  <Text as="p">
                    No manual Standard delivery rate detected. Delivery pricing
                    is served by the carrier service.
                  </Text>
                </Banner>
              ) : null}
              {!state.hasAuZone ? (
                <Banner tone="info">
                  <Text as="p">
                    No AU shipping zone configured. Visit /app/setup-au-shipping
                    first to set up the zone with a Pickup rate.
                  </Text>
                </Banner>
              ) : null}
              {hasManualToRemove ? (
                <Banner tone="warning">
                  <Text as="p">
                    The manual Standard delivery rate competes with the carrier
                    service rate at checkout. On installs where the C.5
                    Function isn&apos;t active (non-Plus + custom-app), the
                    manual rate leaks to customers and overrides the per-zone
                    pricing the merchant configured in admin. Removing it makes
                    the carrier service the single source of truth.
                  </Text>
                </Banner>
              ) : null}
              <Form method="post">
                <Button
                  submit
                  variant="primary"
                  loading={isSubmitting}
                  disabled={isSubmitting || !hasManualToRemove}
                >
                  {hasManualToRemove
                    ? `Remove ${state.manualStandardDeliveryIds.length} manual delivery rate(s)`
                    : "Nothing to remove"}
                </Button>
              </Form>
              {result ? (
                <BlockStack gap="200">
                  <Banner tone={result.ok ? "success" : "critical"}>
                    <Text as="p">
                      {result.ok
                        ? `Cleanup complete${result.removedCount != null ? ` — removed ${result.removedCount} rate(s).` : "."}`
                        : `Failed: ${result.error}`}
                    </Text>
                  </Banner>
                  <BlockStack gap="100">
                    {result.steps.map((s, i) => (
                      <Text as="p" key={i}>
                        • {s}
                      </Text>
                    ))}
                  </BlockStack>
                </BlockStack>
              ) : null}
              <Text as="p" tone="subdued">
                Removes the manual &quot;Standard delivery&quot; rate from the
                Australia shipping zone. Pickup rate (and any other
                non-delivery rate) is left untouched. Idempotent — running
                again when there&apos;s nothing to remove is a no-op.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
