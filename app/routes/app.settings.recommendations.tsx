/**
 * Admin Settings Page: Recommendation Engine Configuration
 * Allows merchants to configure recommendation weights and settings
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  Banner,
  InlineStack,
  Divider,
  RangeSlider,
  Checkbox,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  // Get shop settings
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      id: true,
      recommendationsEnabled: true,
      capacityWeight: true,
      distanceWeight: true,
      routeEfficiencyWeight: true,
      personalizationWeight: true,
      numAlternatives: true,
    },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  // Get recommendation statistics
  const stats = await prisma.recommendationLog.aggregate({
    where: {
      shopifyDomain: session.shop,
      selectedAt: { not: null },
    },
    _count: { id: true },
  });

  const recommendedSelected = await prisma.recommendationLog.count({
    where: {
      shopifyDomain: session.shop,
      wasRecommended: true,
      selectedAt: { not: null },
    },
  });

  const adoptionRate =
    stats._count.id > 0
      ? Math.round((recommendedSelected / stats._count.id) * 100)
      : 0;

  return json({
    shop,
    stats: {
      totalSelections: stats._count.id,
      recommendedSelections: recommendedSelected,
      adoptionRate,
    },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const recommendationsEnabled = formData.get("recommendationsEnabled") === "true";
  const capacityWeight = parseFloat(formData.get("capacityWeight") as string);
  const distanceWeight = parseFloat(formData.get("distanceWeight") as string);
  const routeEfficiencyWeight = parseFloat(
    formData.get("routeEfficiencyWeight") as string
  );
  const personalizationWeight = parseFloat(
    formData.get("personalizationWeight") as string
  );
  const numAlternatives = parseInt(formData.get("numAlternatives") as string);

  // Validate weights sum to reasonable range (0.8 - 1.2 to allow some flexibility)
  const totalWeight =
    capacityWeight + distanceWeight + routeEfficiencyWeight + personalizationWeight;

  if (totalWeight < 0.8 || totalWeight > 1.2) {
    return json(
      {
        error:
          "Weights should sum to approximately 1.0. Current sum: " +
          totalWeight.toFixed(2),
      },
      { status: 400 }
    );
  }

  // Update shop settings
  await prisma.shop.update({
    where: { shopifyDomain: session.shop },
    data: {
      recommendationsEnabled,
      capacityWeight,
      distanceWeight,
      routeEfficiencyWeight,
      personalizationWeight,
      numAlternatives,
    },
  });

  return json({ success: true, message: "Settings saved successfully" });
}

export default function RecommendationSettings() {
  const { shop, stats } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [enabled, setEnabled] = useState(shop.recommendationsEnabled);
  const [capacityWeight, setCapacityWeight] = useState(shop.capacityWeight * 100);
  const [distanceWeight, setDistanceWeight] = useState(shop.distanceWeight * 100);
  const [routeEfficiencyWeight, setRouteEfficiencyWeight] = useState(
    shop.routeEfficiencyWeight * 100
  );
  const [personalizationWeight, setPersonalizationWeight] = useState(
    shop.personalizationWeight * 100
  );
  const [numAlternatives, setNumAlternatives] = useState(
    shop.numAlternatives.toString()
  );
  const [showSuccess, setShowSuccess] = useState(false);

  const isLoading = navigation.state === "submitting";

  // Calculate total weight percentage
  const totalWeight =
    capacityWeight + distanceWeight + routeEfficiencyWeight + personalizationWeight;

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("recommendationsEnabled", enabled.toString());
    formData.append("capacityWeight", (capacityWeight / 100).toString());
    formData.append("distanceWeight", (distanceWeight / 100).toString());
    formData.append("routeEfficiencyWeight", (routeEfficiencyWeight / 100).toString());
    formData.append("personalizationWeight", (personalizationWeight / 100).toString());
    formData.append("numAlternatives", numAlternatives);

    submit(formData, { method: "post" });
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  }, [
    enabled,
    capacityWeight,
    distanceWeight,
    routeEfficiencyWeight,
    personalizationWeight,
    numAlternatives,
    submit,
  ]);

  return (
    <Page
      title="Recommendation Engine Settings"
      backAction={{ content: "Settings", url: "/app" }}
    >
      <Layout>
        {showSuccess && (
          <Layout.Section>
            <Banner
              title="Settings saved successfully"
              tone="success"
              onDismiss={() => setShowSuccess(false)}
            />
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Recommendation Analytics
              </Text>
              <InlineStack gap="800">
                <BlockStack gap="200">
                  <Text as="p" variant="headingSm">
                    {stats.totalSelections}
                  </Text>
                  <Text as="p" tone="subdued">
                    Total Selections
                  </Text>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="p" variant="headingSm">
                    {stats.recommendedSelections}
                  </Text>
                  <Text as="p" tone="subdued">
                    Recommended Selected
                  </Text>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="p" variant="headingSm">
                    {stats.adoptionRate}%
                  </Text>
                  <Text as="p" tone="subdued">
                    Adoption Rate
                  </Text>
                </BlockStack>
              </InlineStack>
              <Text as="p" tone="subdued">
                Adoption rate shows how often customers choose recommended options.
                Higher rates indicate effective recommendations.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Recommendation Engine
              </Text>

              <Checkbox
                label="Enable recommendation engine"
                checked={enabled}
                onChange={setEnabled}
                helpText="When enabled, customers will see recommended slots and locations based on availability, distance, and preferences."
              />

              {!enabled && (
                <Banner tone="warning">
                  Recommendations are currently disabled. Customers will see slots
                  and locations in chronological order without recommendations.
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="600">
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Scoring Weights
                </Text>
                <Text as="p" tone="subdued">
                  Adjust how different factors influence recommendations. Weights
                  should sum to approximately 100%.
                </Text>
                <Text
                  as="p"
                  tone={totalWeight >= 90 && totalWeight <= 110 ? "success" : "critical"}
                >
                  Current total: {totalWeight.toFixed(0)}%
                </Text>
              </BlockStack>

              <Divider />

              <BlockStack gap="400">
                <Text as="h3" variant="headingSm">
                  Capacity Weight ({capacityWeight.toFixed(0)}%)
                </Text>
                <RangeSlider
                  label=""
                  value={capacityWeight}
                  onChange={setCapacityWeight}
                  min={0}
                  max={100}
                  output
                />
                <Text as="p" tone="subdued">
                  Prioritize slots with more available capacity. Higher weight =
                  recommend slots with fewer bookings.
                </Text>
              </BlockStack>

              <Divider />

              <BlockStack gap="400">
                <Text as="h3" variant="headingSm">
                  Distance Weight ({distanceWeight.toFixed(0)}%)
                </Text>
                <RangeSlider
                  label=""
                  value={distanceWeight}
                  onChange={setDistanceWeight}
                  min={0}
                  max={100}
                  output
                />
                <Text as="p" tone="subdued">
                  Prioritize locations closer to the customer. Higher weight =
                  recommend nearest pickup points or delivery locations.
                </Text>
              </BlockStack>

              <Divider />

              <BlockStack gap="400">
                <Text as="h3" variant="headingSm">
                  Route Efficiency Weight ({routeEfficiencyWeight.toFixed(0)}%)
                </Text>
                <RangeSlider
                  label=""
                  value={routeEfficiencyWeight}
                  onChange={setRouteEfficiencyWeight}
                  min={0}
                  max={100}
                  output
                />
                <Text as="p" tone="subdued">
                  Cluster deliveries geographically to optimize routes. Higher weight
                  = recommend slots that group nearby deliveries together.
                </Text>
              </BlockStack>

              <Divider />

              <BlockStack gap="400">
                <Text as="h3" variant="headingSm">
                  Personalization Weight ({personalizationWeight.toFixed(0)}%)
                </Text>
                <RangeSlider
                  label=""
                  value={personalizationWeight}
                  onChange={setPersonalizationWeight}
                  min={0}
                  max={100}
                  output
                />
                <Text as="p" tone="subdued">
                  Match customer's historical preferences. Higher weight = recommend
                  slots similar to their past orders.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Display Settings
              </Text>

              <TextField
                label="Number of alternative suggestions"
                type="number"
                value={numAlternatives}
                onChange={setNumAlternatives}
                helpText="How many alternative slots to show when a customer's preferred time is unavailable."
                min={1}
                max={10}
                autoComplete="off"
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <InlineStack align="end">
            <Button
              variant="primary"
              onClick={handleSave}
              loading={isLoading}
              disabled={totalWeight < 90 || totalWeight > 110}
            >
              Save Settings
            </Button>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
