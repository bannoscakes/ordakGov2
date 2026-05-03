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
                locationGroupZones(first: 10) { nodes { zone { id name } } }
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

    // 3. Check whether the AU zone already exists in the profile.
    const existingAuZone = profile.profileLocationGroups
      ?.flatMap((g: { locationGroupZones: { nodes: Array<{ zone: { name: string; id: string } }> } }) => g.locationGroupZones.nodes)
      ?.find((z: { zone: { name: string } }) => /australia/i.test(z.zone.name));
    if (existingAuZone) {
      steps.push(`AU zone already exists: ${existingAuZone.zone.name}`);
      return json<Status>({ ok: true, steps });
    }

    // 4. Check whether the AU location is already in a location group on
    //    this profile. If yes, add a zone to that group. If no, create a
    //    new group containing the location and the zone.
    const existingGroup = profile.profileLocationGroups?.find(
      (g: { locationGroup: { locations: { nodes: Array<{ id: string }> } } }) =>
        g.locationGroup.locations.nodes.some((l) => l.id === auLocation.id),
    );

    if (existingGroup) {
      // Add zone to existing group
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
                      methodDefinitionsToCreate: [
                        {
                          name: "Standard delivery",
                          rateDefinition: {
                            price: { amount: "10.00", currencyCode: "USD" },
                          },
                        },
                      ],
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
      steps.push("Added Australia zone to existing location group");
    } else {
      // Create new group with location + zone
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
                      methodDefinitionsToCreate: [
                        {
                          name: "Standard delivery",
                          rateDefinition: {
                            price: { amount: "10.00", currencyCode: "USD" },
                          },
                        },
                      ],
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
