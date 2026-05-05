// One-shot shipping setup: adds the AU Shop location to the General
// delivery profile and creates an AU zone with ONLY the Pickup at
// Annandale $0 manual flat rate. Standard delivery pricing is handled
// entirely by our Carrier Service callback (computes
// `zone.basePrice + slot.priceAdjustment` from the merchant-configured
// admin), so we deliberately do NOT create a manual Standard delivery
// rate that would compete with our dynamic rate at checkout.
//
// History: this route used to create a manual "Standard delivery $15"
// rate. The C.5 Delivery Customization Function would then hide it
// when our Carrier Service rate was present. That worked when the
// Function was active, but on non-Plus + custom-app installs the
// Function doesn't activate, so the $15 manual rate leaked to checkout
// (this caused the cart-vs-checkout mismatch reported on 2026-05-05).
// Removing the manual delivery rate entirely closes this foot-gun and
// makes the carrier service the single source of truth for delivery
// pricing. Use /app/cleanup-shipping-zones to remove an existing
// manual Standard delivery rate from a previously-set-up store.
//
// Pickup at Annandale $0 stays — the carrier callback already returns
// a $0 pickup rate of its own, so this manual fallback is redundant
// (not foot-gun) and acts as belt-and-braces if the callback is
// unhealthy.
//
// Phase D will replace this with a proper merchant-facing setup wizard
// (this route is a dev-store convenience, not a production feature).
//
// SECURITY: the destructive mutations live in `action`, not `loader` —
// loaders fire on every GET, including App Bridge prefetch-on-hover and
// browser link-preload. Running shipping mutations on hover would
// silently mutate production delivery configuration. The loader returns
// only the current state for the form to render.

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

interface CurrentState {
  hasProfile: boolean;
  profileName: string | null;
  hasAuLocation: boolean;
  auLocationName: string | null;
  hasAuZone: boolean;
  hasPickupRate: boolean;
  // Diagnostic only — surface a manual Standard delivery rate so the
  // merchant can see they need to remove it via /app/cleanup-shipping-zones.
  // We never CREATE this rate here.
  hasManualStandardDeliveryRate: boolean;
}

interface Status {
  ok: boolean;
  steps: string[];
  error?: string;
}

interface DeliveryProfile {
  id: string;
  name: string;
  default: boolean;
  profileLocationGroups?: Array<{
    locationGroup: { id: string; locations: { nodes: Array<{ id: string; name: string }> } };
    locationGroupZones: {
      nodes: Array<{
        zone: { id: string; name: string };
        methodDefinitions: { nodes: Array<{ name: string }> };
      }>;
    };
  }>;
}

interface ShopLocation {
  id: string;
  name: string;
  address: { country: string; countryCode: string };
}

// Loader: read-only snapshot of current shipping config so the form can
// show the merchant what state the store is in before they POST.
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const profilesRes = await admin.graphql(
    `#graphql
      query OrdakGoDeliveryProfiles {
        deliveryProfiles(first: 5) {
          nodes {
            id
            name
            default
            profileLocationGroups {
              locationGroup { id locations(first: 25) { nodes { id name } } }
              locationGroupZones(first: 10) {
                nodes {
                  zone { id name }
                  methodDefinitions(first: 10) { nodes { id name } }
                }
              }
            }
          }
        }
      }`,
  );
  const profilesBody = await profilesRes.json();
  const profile: DeliveryProfile | null =
    profilesBody.data?.deliveryProfiles?.nodes?.find(
      (p: DeliveryProfile) => p.default,
    ) ?? profilesBody.data?.deliveryProfiles?.nodes?.[0] ?? null;

  const locsRes = await admin.graphql(
    `#graphql
      query OrdakGoLocations {
        locations(first: 25) {
          nodes { id name address { country countryCode } }
        }
      }`,
  );
  const locsBody = await locsRes.json();
  const auLocation: ShopLocation | null = locsBody.data?.locations?.nodes?.find(
    (l: ShopLocation) => l.address.countryCode === "AU",
  ) ?? null;

  const auZoneEntry = profile?.profileLocationGroups
    ?.flatMap((g) => g.locationGroupZones.nodes)
    ?.find((z) => /australia/i.test(z.zone.name));
  const methodNames = (auZoneEntry?.methodDefinitions?.nodes ?? []).map((m) =>
    m.name.toLowerCase(),
  );

  return json<CurrentState>({
    hasProfile: !!profile,
    profileName: profile?.name ?? null,
    hasAuLocation: !!auLocation,
    auLocationName: auLocation?.name ?? null,
    hasAuZone: !!auZoneEntry,
    hasPickupRate: methodNames.some((n) => n.includes("pickup")),
    // Word-boundary match so we don't false-positive on
    // "Standardized delivery", "Premium standard", etc. Mirrors the
    // pattern in app.cleanup-shipping-zones.tsx so the diagnostic and
    // the cleanup route agree on what counts as the stale rate.
    hasManualStandardDeliveryRate: methodNames.some((n) =>
      /\bstandard\s+delivery\b/.test(n),
    ),
  });
}

// Action: the destructive write path. Triggered by an explicit POST from
// the form below — not on page-load or prefetch.
export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const steps: string[] = [];

  try {
    const profilesRes = await admin.graphql(
      `#graphql
        query OrdakGoDeliveryProfiles {
          deliveryProfiles(first: 5) {
            nodes {
              id
              name
              default
              profileLocationGroups {
                locationGroup { id locations(first: 25) { nodes { id name } } }
                locationGroupZones(first: 10) {
                  nodes {
                    zone { id name }
                    methodDefinitions(first: 10) { nodes { id name } }
                  }
                }
              }
            }
          }
        }`,
    );
    const profilesBody = await profilesRes.json();
    const profile: DeliveryProfile | undefined =
      profilesBody.data?.deliveryProfiles?.nodes?.find(
        (p: DeliveryProfile) => p.default,
      ) ?? profilesBody.data?.deliveryProfiles?.nodes?.[0];
    if (!profile) {
      return json<Status>({ ok: false, steps, error: "No delivery profile found" });
    }
    steps.push(`Found delivery profile: ${profile.name} (${profile.id})`);

    const locsRes = await admin.graphql(
      `#graphql
        query OrdakGoLocations {
          locations(first: 25) {
            nodes { id name address { country countryCode } }
          }
        }`,
    );
    const locsBody = await locsRes.json();
    const auLocation: ShopLocation | undefined = locsBody.data?.locations?.nodes?.find(
      (l: ShopLocation) => l.address.countryCode === "AU",
    );
    if (!auLocation) {
      return json<Status>({
        ok: false,
        steps,
        error: "No Australian location found. Create one in Settings → Locations first.",
      });
    }
    steps.push(`Found AU location: ${auLocation.name} (${auLocation.id})`);

    // We only ever create the Pickup rate — delivery pricing is the
    // carrier service callback's responsibility (zone.basePrice +
    // slot.priceAdjustment). Creating a manual "Standard delivery" rate
    // here previously caused the cart-vs-checkout mismatch on non-Plus
    // installs where the C.5 Function (which would hide the manual
    // rate) doesn't activate.
    const existingAuZoneEntry = profile.profileLocationGroups
      ?.flatMap((g) => g.locationGroupZones.nodes)
      ?.find((z) => /australia/i.test(z.zone.name));
    const existingAuZone = existingAuZoneEntry?.zone;
    const existingMethodNames = (existingAuZoneEntry?.methodDefinitions?.nodes ?? []).map((m) =>
      m.name.toLowerCase(),
    );

    const ratesToCreate: Array<{
      name: string;
      rateDefinition: { price: { amount: string; currencyCode: string } };
    }> = [];
    if (!existingMethodNames.some((n) => n.includes("pickup"))) {
      ratesToCreate.push({
        name: "Pickup at Annandale",
        rateDefinition: { price: { amount: "0.00", currencyCode: "AUD" } },
      });
    }

    // Diagnostic warning: if the merchant has an existing manual
    // Standard delivery rate (from a previous run of the old version of
    // this route, or from manual admin config), surface it in the
    // success message so they know to clean it up.
    // Same word-boundary match as the loader and cleanup route.
    const hasStaleStandardRate = existingMethodNames.some((n) =>
      /\bstandard\s+delivery\b/.test(n),
    );

    if (existingAuZone && ratesToCreate.length === 0) {
      const msg = hasStaleStandardRate
        ? "AU zone exists with Pickup at Annandale. ⚠️ Manual 'Standard delivery' rate also detected — visit /app/cleanup-shipping-zones to remove it (carrier service handles delivery pricing now)."
        : "AU zone exists with Pickup at Annandale rate.";
      steps.push(msg);
      return json<Status>({ ok: true, steps });
    }

    const existingGroup = profile.profileLocationGroups?.find((g) =>
      g.locationGroup.locations.nodes.some((l) => l.id === auLocation.id),
    );

    if (existingAuZone && ratesToCreate.length > 0) {
      const updateRes = await admin.graphql(
        `#graphql
          mutation OrdakGoAddRates($id: ID!, $profile: DeliveryProfileInput!) {
            deliveryProfileUpdate(id: $id, profile: $profile) {
              profile { id }
              userErrors { field message }
            }
          }`,
        {
          variables: {
            id: profile.id,
            profile: {
              locationGroupsToUpdate: [
                {
                  id: existingGroup!.locationGroup.id,
                  zonesToUpdate: [
                    {
                      id: existingAuZone.id,
                      methodDefinitionsToCreate: ratesToCreate,
                    },
                  ],
                },
              ],
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
          error: `Add rates failed: ${errs.map((e: { field: string[]; message: string }) => `${e.field?.join(".")}: ${e.message}`).join(", ")}`,
        });
      }
      steps.push(
        `Added ${ratesToCreate.length} rate(s) to existing AU zone: ${ratesToCreate.map((r) => r.name).join(", ")}`,
      );
    } else if (existingGroup) {
      const updateRes = await admin.graphql(
        `#graphql
          mutation OrdakGoAddZone($id: ID!, $profile: DeliveryProfileInput!) {
            deliveryProfileUpdate(id: $id, profile: $profile) {
              profile { id }
              userErrors { field message }
            }
          }`,
        {
          variables: {
            id: profile.id,
            profile: {
              locationGroupsToUpdate: [
                {
                  id: existingGroup.locationGroup.id,
                  zonesToCreate: [
                    {
                      name: "Australia",
                      countries: [{ code: "AU", includeAllProvinces: true }],
                      methodDefinitionsToCreate: ratesToCreate,
                    },
                  ],
                },
              ],
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
          error: `Add zone failed: ${errs.map((e: { field: string[]; message: string }) => `${e.field?.join(".")}: ${e.message}`).join(", ")}`,
        });
      }
      steps.push(
        "Added Australia zone with Pickup at Annandale to existing location group (delivery rate served by carrier service)",
      );
    } else {
      const createRes = await admin.graphql(
        `#graphql
          mutation OrdakGoCreateGroup($id: ID!, $profile: DeliveryProfileInput!) {
            deliveryProfileUpdate(id: $id, profile: $profile) {
              profile { id }
              userErrors { field message }
            }
          }`,
        {
          variables: {
            id: profile.id,
            profile: {
              locationGroupsToCreate: [
                {
                  locations: [auLocation.id],
                  zonesToCreate: [
                    {
                      name: "Australia",
                      countries: [{ code: "AU", includeAllProvinces: true }],
                      methodDefinitionsToCreate: ratesToCreate,
                    },
                  ],
                },
              ],
            },
          },
        },
      );
      const createBody = await createRes.json();
      const errs = createBody.data?.deliveryProfileUpdate?.userErrors ?? [];
      if (errs.length) {
        return json<Status>({
          ok: false,
          steps,
          error: `Create group failed: ${errs.map((e: { field: string[]; message: string }) => `${e.field?.join(".")}: ${e.message}`).join(", ")}`,
        });
      }
      steps.push(
        "Created new location group with AU location + Australia zone + Pickup at Annandale (delivery rate served by carrier service)",
      );
    }

    return json<Status>({ ok: true, steps });
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

export default function SetupAuShipping() {
  const state = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const allSet =
    state.hasProfile && state.hasAuLocation && state.hasAuZone && state.hasPickupRate;

  return (
    <Page title="Setup AU shipping (dev convenience)">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Current state
              </Text>
              <List type="bullet">
                <List.Item>
                  Delivery profile: {state.profileName ?? "none"} {state.hasProfile ? "✓" : "✗"}
                </List.Item>
                <List.Item>
                  AU location: {state.auLocationName ?? "none"} {state.hasAuLocation ? "✓" : "✗"}
                </List.Item>
                <List.Item>Australia zone: {state.hasAuZone ? "✓" : "✗"}</List.Item>
                <List.Item>Pickup at Annandale rate: {state.hasPickupRate ? "✓" : "✗"}</List.Item>
                {state.hasManualStandardDeliveryRate ? (
                  <List.Item>
                    ⚠️ Manual &quot;Standard delivery&quot; rate detected — visit{" "}
                    <a href="/app/cleanup-shipping-zones">/app/cleanup-shipping-zones</a>{" "}
                    to remove it. Delivery pricing is handled by the carrier service
                    (zone.basePrice + slot.priceAdjustment).
                  </List.Item>
                ) : null}
              </List>
              {allSet ? (
                <Banner tone="success">
                  <Text as="p">Shipping is fully configured. Re-running is a no-op.</Text>
                </Banner>
              ) : null}
              <Form method="post">
                <Button submit variant="primary" loading={isSubmitting} disabled={isSubmitting}>
                  {allSet ? "Re-run setup (no-op)" : "Run setup"}
                </Button>
              </Form>
              {result ? (
                <BlockStack gap="200">
                  <Banner tone={result.ok ? "success" : "critical"}>
                    <Text as="p">
                      {result.ok ? "Shipping setup complete." : `Failed: ${result.error}`}
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
                Adds the AU location and an Australia shipping zone with the
                Pickup at Annandale $0 manual flat rate to the default delivery
                profile. Delivery pricing is served by the Carrier Service
                callback (zone.basePrice + slot.priceAdjustment, both
                merchant-configured). No manual Standard delivery rate is
                created — that would compete with the carrier service rate at
                checkout. Idempotent — only creates what&apos;s missing.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
