// One-shot shipping setup: adds the AU Shop location to the General
// delivery profile and creates an AU zone with a $10 flat rate. This
// unblocks the dev-store e2e test (Phase C order pipeline) — without a
// shipping zone matching the customer's address, Shopify never invokes
// our carrier service or our delivery customization function.
//
// Phase D will replace this with a proper merchant-facing setup wizard
// (this route is a dev-store convenience, not a production feature).

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

interface Status {
  ok: boolean;
  steps: string[];
  error?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const steps: string[] = [];

  try {
    // 1. Find the default delivery profile (the General profile).
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
    const profile =
      profilesBody.data?.deliveryProfiles?.nodes?.find(
        (p: { default: boolean }) => p.default,
      ) ?? profilesBody.data?.deliveryProfiles?.nodes?.[0];
    if (!profile) {
      return json<Status>({ ok: false, steps, error: "No delivery profile found" });
    }
    steps.push(`Found delivery profile: ${profile.name} (${profile.id})`);

    // 2. Find the Shop location (the AU one).
    const locsRes = await admin.graphql(
      `#graphql
        query OrdakGoLocations {
          locations(first: 25) {
            nodes { id name address { country countryCode } }
          }
        }`,
    );
    const locsBody = await locsRes.json();
    const auLocation = locsBody.data?.locations?.nodes?.find(
      (l: { address: { countryCode: string } }) => l.address.countryCode === "AU",
    );
    if (!auLocation) {
      return json<Status>({
        ok: false,
        steps,
        error: "No Australian location found. Create one in Settings → Locations first.",
      });
    }
    steps.push(`Found AU location: ${auLocation.name} (${auLocation.id})`);

    // 3. Find the existing AU zone (if any) plus its method definitions.
    //    We need to ensure both rates exist:
    //      - "Standard delivery" $15 — for delivery-mode carts
    //      - "Pickup at Annandale" $0 — for pickup-mode carts
    //    Our delivery-rate-filter Function picks which one to show by
    //    matching on the rate handle (we keep the names with the word
    //    "Pickup" so the function's regex catches them).
    const existingAuZoneEntry = profile.profileLocationGroups
      ?.flatMap((g: {
        locationGroupZones: {
          nodes: Array<{
            zone: { id: string; name: string };
            methodDefinitions: { nodes: Array<{ name: string }> };
          }>;
        };
      }) => g.locationGroupZones.nodes)
      ?.find((z: { zone: { name: string } }) => /australia/i.test(z.zone.name));
    const existingAuZone = existingAuZoneEntry?.zone;
    const existingMethodNames = (existingAuZoneEntry?.methodDefinitions?.nodes ?? []).map(
      (m: { name: string }) => m.name.toLowerCase(),
    );

    const ratesToCreate: Array<{
      name: string;
      rateDefinition: { price: { amount: string; currencyCode: string } };
    }> = [];
    if (!existingMethodNames.some((n: string) => n.includes("standard"))) {
      ratesToCreate.push({
        name: "Standard delivery",
        rateDefinition: { price: { amount: "15.00", currencyCode: "AUD" } },
      });
    }
    if (!existingMethodNames.some((n: string) => n.includes("pickup"))) {
      ratesToCreate.push({
        name: "Pickup at Annandale",
        rateDefinition: { price: { amount: "0.00", currencyCode: "AUD" } },
      });
    }

    if (existingAuZone && ratesToCreate.length === 0) {
      steps.push(`AU zone exists with both rates: Standard delivery + Pickup at Annandale`);
      return json<Status>({ ok: true, steps });
    }

    // 4. Check whether the AU location is already in a location group on
    //    this profile. If yes, add a zone or update existing zone. If no,
    //    create a new group containing the location and the zone.
    const existingGroup = profile.profileLocationGroups?.find(
      (g: { locationGroup: { locations: { nodes: Array<{ id: string }> } } }) =>
        g.locationGroup.locations.nodes.some((l) => l.id === auLocation.id),
    );

    if (existingAuZone && ratesToCreate.length > 0) {
      // Zone exists, just need to add missing rates to it.
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
      steps.push(`Added ${ratesToCreate.length} rate(s) to existing AU zone: ${ratesToCreate.map((r) => r.name).join(", ")}`);
    } else if (existingGroup) {
      // Group exists, zone doesn't — add zone with both rates.
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
      steps.push("Added Australia zone with Standard delivery + Pickup at Annandale to existing location group");
    } else {
      // Create new group with location + zone + both rates.
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
      steps.push("Created new location group with AU location + Australia zone + $10 flat rate");
    }

    return json<Status>({ ok: true, steps });
  } catch (err) {
    let message = "unknown";
    if (err instanceof Response) {
      try {
        const body = await err.json();
        message = JSON.stringify(body);
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
  const status = useLoaderData<typeof loader>();
  return (
    <Page title="Setup AU shipping (dev convenience)">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Banner tone={status.ok ? "success" : "critical"}>
                <Text as="p">
                  {status.ok ? "Shipping setup complete." : `Failed: ${status.error}`}
                </Text>
              </Banner>
              <BlockStack gap="100">
                {status.steps.map((s, i) => (
                  <Text as="p" key={i}>
                    • {s}
                  </Text>
                ))}
              </BlockStack>
              <Text as="p" tone="subdued">
                Adds the AU location and an Australia shipping zone with a $10
                flat rate to the default delivery profile. Re-run anytime; it
                checks for an existing AU zone and skips if present.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
