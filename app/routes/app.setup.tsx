import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  RangeSlider,
  Checkbox,
  Select,
  ProgressBar,
  Badge,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Setup wizard steps
const STEPS = {
  WELCOME: 0,
  SHOP_SETTINGS: 1,
  LOCATION: 2,
  ZONE: 3,
  RULES: 4,
  COMPLETE: 5,
};

const STEP_TITLES = [
  "Welcome",
  "Shop Settings",
  "First Location",
  "First Zone",
  "Business Rules",
  "Setup Complete",
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    include: {
      locations: true,
      zones: true,
      rules: true,
    },
  });

  if (!shop) {
    throw new Error("Shop not found");
  }

  // Check if setup has been completed
  const isSetupComplete = shop.locations.length > 0 && shop.zones.length > 0;

  return json({
    shop: {
      id: shop.id,
      shopifyDomain: shop.shopifyDomain,
      recommendationsEnabled: shop.recommendationsEnabled,
      capacityWeight: shop.capacityWeight,
      distanceWeight: shop.distanceWeight,
      routeEfficiencyWeight: shop.routeEfficiencyWeight,
      personalizationWeight: shop.personalizationWeight,
    },
    isSetupComplete,
    locationCount: shop.locations.length,
    zoneCount: shop.zones.length,
    ruleCount: shop.rules.length,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const step = formData.get("step");

  try {
    switch (step) {
      case "shop_settings": {
        const recommendationsEnabled = formData.get("recommendationsEnabled") === "true";
        const capacityWeight = parseFloat(formData.get("capacityWeight") as string);
        const distanceWeight = parseFloat(formData.get("distanceWeight") as string);
        const routeEfficiencyWeight = parseFloat(formData.get("routeEfficiencyWeight") as string);
        const personalizationWeight = parseFloat(formData.get("personalizationWeight") as string);

        await prisma.shop.update({
          where: { shopifyDomain: session.shop },
          data: {
            recommendationsEnabled,
            capacityWeight,
            distanceWeight,
            routeEfficiencyWeight,
            personalizationWeight,
          },
        });

        return json({ success: true, step: "shop_settings" });
      }

      case "location": {
        const name = formData.get("name") as string;
        const address = formData.get("address") as string;
        const postcode = formData.get("postcode") as string;
        const timezone = formData.get("timezone") as string;
        const supportsDelivery = formData.get("supportsDelivery") === "true";
        const supportsPickup = formData.get("supportsPickup") === "true";
        const latitude = formData.get("latitude") ? parseFloat(formData.get("latitude") as string) : null;
        const longitude = formData.get("longitude") ? parseFloat(formData.get("longitude") as string) : null;

        const shop = await prisma.shop.findUnique({
          where: { shopifyDomain: session.shop },
        });

        if (!shop) {
          throw new Error("Shop not found");
        }

        const location = await prisma.location.create({
          data: {
            shopId: shop.id,
            name,
            address,
            postcode,
            timezone,
            supportsDelivery,
            supportsPickup,
            latitude,
            longitude,
          },
        });

        return json({ success: true, step: "location", locationId: location.id });
      }

      case "zone": {
        const name = formData.get("name") as string;
        const zoneType = formData.get("zoneType") as string;
        const locationId = formData.get("locationId") as string;

        const shop = await prisma.shop.findUnique({
          where: { shopifyDomain: session.shop },
        });

        if (!shop) {
          throw new Error("Shop not found");
        }

        const zoneData: any = {
          shopId: shop.id,
          locationId,
          name,
          zoneType,
        };

        // Handle different zone types
        if (zoneType === "postcode_range") {
          zoneData.postcodeStart = formData.get("postcodeStart") as string;
          zoneData.postcodeEnd = formData.get("postcodeEnd") as string;
        } else if (zoneType === "postcode_list") {
          const postcodes = (formData.get("postcodes") as string).split(",").map(p => p.trim());
          zoneData.postcodes = postcodes;
        } else if (zoneType === "radius") {
          zoneData.radiusKm = parseFloat(formData.get("radiusKm") as string);
        }

        const zone = await prisma.zone.create({
          data: zoneData,
        });

        return json({ success: true, step: "zone", zoneId: zone.id });
      }

      case "rules": {
        const shop = await prisma.shop.findUnique({
          where: { shopifyDomain: session.shop },
        });

        if (!shop) {
          throw new Error("Shop not found");
        }

        // Create cutoff time rule
        const cutoffEnabled = formData.get("cutoffEnabled") === "true";
        if (cutoffEnabled) {
          const cutoffTime = formData.get("cutoffTime") as string;
          const cutoffDaysBefore = parseInt(formData.get("cutoffDaysBefore") as string);

          await prisma.rule.create({
            data: {
              shopId: shop.id,
              name: "Order Cutoff Time",
              ruleType: "cutoff",
              cutoffTime,
              cutoffDaysBefore,
              isActive: true,
            },
          });
        }

        // Create lead time rule
        const leadTimeEnabled = formData.get("leadTimeEnabled") === "true";
        if (leadTimeEnabled) {
          const leadTimeDays = parseInt(formData.get("leadTimeDays") as string);

          await prisma.rule.create({
            data: {
              shopId: shop.id,
              name: "Minimum Lead Time",
              ruleType: "lead_time",
              leadTimeDays,
              isActive: true,
            },
          });
        }

        return json({ success: true, step: "rules" });
      }

      default:
        return json({ success: false, error: "Invalid step" }, { status: 400 });
    }
  } catch (error) {
    console.error("Setup wizard error:", error);
    return json(
      { success: false, error: error instanceof Error ? error.message : "An error occurred" },
      { status: 500 }
    );
  }
}

export default function SetupWizard() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const submit = useSubmit();

  const [currentStep, setCurrentStep] = useState(STEPS.WELCOME);
  const [createdLocationId, setCreatedLocationId] = useState<string>("");

  // Shop Settings State
  const [recommendationsEnabled, setRecommendationsEnabled] = useState(
    loaderData.shop.recommendationsEnabled
  );
  const [capacityWeight, setCapacityWeight] = useState(loaderData.shop.capacityWeight);
  const [distanceWeight, setDistanceWeight] = useState(loaderData.shop.distanceWeight);
  const [routeEfficiencyWeight, setRouteEfficiencyWeight] = useState(
    loaderData.shop.routeEfficiencyWeight
  );
  const [personalizationWeight, setPersonalizationWeight] = useState(
    loaderData.shop.personalizationWeight
  );

  // Location State
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationPostcode, setLocationPostcode] = useState("");
  const [locationTimezone, setLocationTimezone] = useState("Europe/London");
  const [supportsDelivery, setSupportsDelivery] = useState(true);
  const [supportsPickup, setSupportsPickup] = useState(false);
  const [locationLatitude, setLocationLatitude] = useState("");
  const [locationLongitude, setLocationLongitude] = useState("");

  // Zone State
  const [zoneName, setZoneName] = useState("");
  const [zoneType, setZoneType] = useState<string>("postcode_range");
  const [postcodeStart, setPostcodeStart] = useState("");
  const [postcodeEnd, setPostcodeEnd] = useState("");
  const [postcodes, setPostcodes] = useState("");
  const [radiusKm, setRadiusKm] = useState("10");

  // Rules State
  const [cutoffEnabled, setCutoffEnabled] = useState(true);
  const [cutoffTime, setCutoffTime] = useState("12:00");
  const [cutoffDaysBefore, setCutoffDaysBefore] = useState("1");
  const [leadTimeEnabled, setLeadTimeEnabled] = useState(true);
  const [leadTimeDays, setLeadTimeDays] = useState("2");

  // Handle step completion
  const handleStepComplete = (step: number, formData?: any) => {
    if (formData) {
      submit(formData, { method: "post" });
    }

    // Move to next step
    if (step < STEPS.COMPLETE) {
      setCurrentStep(step + 1);
    }
  };

  // Watch for action responses
  if (actionData?.success) {
    if (actionData.step === "location" && actionData.locationId && !createdLocationId) {
      setCreatedLocationId(actionData.locationId);
    }
  }

  const progress = (currentStep / (STEP_TITLES.length - 1)) * 100;

  return (
    <Page
      title="Setup Wizard"
      backAction={{ content: "Dashboard", url: "/app" }}
      subtitle={`Step ${currentStep + 1} of ${STEP_TITLES.length}: ${STEP_TITLES[currentStep]}`}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <ProgressBar progress={progress} size="small" />
              <Text as="p" variant="bodySm" tone="subdued">
                {Math.round(progress)}% complete
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Step 0: Welcome */}
        {currentStep === STEPS.WELCOME && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  Welcome to Ordak Setup!
                </Text>
                <Text as="p">
                  This wizard will guide you through setting up your delivery and pickup scheduling
                  system. You'll configure:
                </Text>
                <BlockStack gap="200">
                  <InlineStack gap="200" align="start">
                    <Badge tone="info">1</Badge>
                    <Text as="p">Shop settings and recommendation preferences</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Badge tone="info">2</Badge>
                    <Text as="p">Your first location (warehouse, store, or depot)</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Badge tone="info">3</Badge>
                    <Text as="p">Your first delivery/pickup zone</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Badge tone="info">4</Badge>
                    <Text as="p">Basic business rules (cutoff times, lead times)</Text>
                  </InlineStack>
                </BlockStack>

                {loaderData.isSetupComplete && (
                  <Banner tone="warning">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold">
                        Setup already completed
                      </Text>
                      <Text as="p">
                        You have {loaderData.locationCount} location(s) and {loaderData.zoneCount}{" "}
                        zone(s) configured. You can still run this wizard to add more
                        configuration.
                      </Text>
                    </BlockStack>
                  </Banner>
                )}

                <InlineStack align="end">
                  <Button variant="primary" onClick={() => setCurrentStep(STEPS.SHOP_SETTINGS)}>
                    Get Started
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Step 1: Shop Settings */}
        {currentStep === STEPS.SHOP_SETTINGS && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  Shop Settings
                </Text>
                <Text as="p">
                  Configure how the recommendation engine prioritizes different factors when
                  suggesting delivery slots to customers.
                </Text>

                {actionData && !actionData.success && (
                  <Banner tone="critical">
                    <Text as="p">{actionData.error || "An error occurred"}</Text>
                  </Banner>
                )}

                <FormLayout>
                  <Checkbox
                    label="Enable Smart Recommendations"
                    helpText="Use AI-powered recommendations to suggest optimal delivery slots"
                    checked={recommendationsEnabled}
                    onChange={setRecommendationsEnabled}
                  />

                  <Divider />

                  <Text as="h3" variant="headingMd">
                    Recommendation Weights
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Adjust how much each factor influences slot recommendations (0-100)
                  </Text>

                  <RangeSlider
                    label={`Capacity Weight: ${capacityWeight}`}
                    value={capacityWeight}
                    onChange={setCapacityWeight}
                    min={0}
                    max={100}
                    output
                    helpText="Prioritize slots with more available capacity"
                  />

                  <RangeSlider
                    label={`Distance Weight: ${distanceWeight}`}
                    value={distanceWeight}
                    onChange={setDistanceWeight}
                    min={0}
                    max={100}
                    output
                    helpText="Prioritize locations closer to the customer"
                  />

                  <RangeSlider
                    label={`Route Efficiency Weight: ${routeEfficiencyWeight}`}
                    value={routeEfficiencyWeight}
                    onChange={setRouteEfficiencyWeight}
                    min={0}
                    max={100}
                    output
                    helpText="Prioritize slots that optimize delivery routes"
                  />

                  <RangeSlider
                    label={`Personalization Weight: ${personalizationWeight}`}
                    value={personalizationWeight}
                    onChange={setPersonalizationWeight}
                    min={0}
                    max={100}
                    output
                    helpText="Prioritize based on customer's past preferences"
                  />
                </FormLayout>

                <InlineStack align="space-between">
                  <Button onClick={() => setCurrentStep(STEPS.WELCOME)}>Back</Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      const formData = new FormData();
                      formData.append("step", "shop_settings");
                      formData.append("recommendationsEnabled", String(recommendationsEnabled));
                      formData.append("capacityWeight", String(capacityWeight));
                      formData.append("distanceWeight", String(distanceWeight));
                      formData.append("routeEfficiencyWeight", String(routeEfficiencyWeight));
                      formData.append("personalizationWeight", String(personalizationWeight));
                      handleStepComplete(STEPS.SHOP_SETTINGS, formData);
                    }}
                  >
                    Continue
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Step 2: Location */}
        {currentStep === STEPS.LOCATION && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  Create Your First Location
                </Text>
                <Text as="p">
                  A location is a physical place from which you deliver or offer pickup (e.g.,
                  warehouse, store, depot).
                </Text>

                {actionData && !actionData.success && (
                  <Banner tone="critical">
                    <Text as="p">{actionData.error || "An error occurred"}</Text>
                  </Banner>
                )}

                <FormLayout>
                  <TextField
                    label="Location Name"
                    value={locationName}
                    onChange={setLocationName}
                    placeholder="Main Warehouse"
                    autoComplete="off"
                    requiredIndicator
                  />

                  <TextField
                    label="Address"
                    value={locationAddress}
                    onChange={setLocationAddress}
                    placeholder="123 Main Street, London"
                    autoComplete="off"
                    requiredIndicator
                  />

                  <TextField
                    label="Postcode"
                    value={locationPostcode}
                    onChange={setLocationPostcode}
                    placeholder="SW1A 1AA"
                    autoComplete="off"
                    requiredIndicator
                  />

                  <Select
                    label="Timezone"
                    options={[
                      { label: "Europe/London", value: "Europe/London" },
                      { label: "America/New_York", value: "America/New_York" },
                      { label: "America/Los_Angeles", value: "America/Los_Angeles" },
                      { label: "Europe/Paris", value: "Europe/Paris" },
                      { label: "Asia/Tokyo", value: "Asia/Tokyo" },
                    ]}
                    value={locationTimezone}
                    onChange={setLocationTimezone}
                  />

                  <BlockStack gap="200">
                    <Checkbox
                      label="Supports Delivery"
                      checked={supportsDelivery}
                      onChange={setSupportsDelivery}
                    />
                    <Checkbox
                      label="Supports Pickup"
                      checked={supportsPickup}
                      onChange={setSupportsPickup}
                    />
                  </BlockStack>

                  <Divider />

                  <Text as="h3" variant="headingMd">
                    Coordinates (Optional)
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    For distance-based recommendations
                  </Text>

                  <InlineStack gap="400">
                    <TextField
                      label="Latitude"
                      type="number"
                      value={locationLatitude}
                      onChange={setLocationLatitude}
                      placeholder="51.5074"
                      autoComplete="off"
                    />
                    <TextField
                      label="Longitude"
                      type="number"
                      value={locationLongitude}
                      onChange={setLocationLongitude}
                      placeholder="-0.1278"
                      autoComplete="off"
                    />
                  </InlineStack>
                </FormLayout>

                <InlineStack align="space-between">
                  <Button onClick={() => setCurrentStep(STEPS.SHOP_SETTINGS)}>Back</Button>
                  <Button
                    variant="primary"
                    disabled={!locationName || !locationAddress || !locationPostcode}
                    onClick={() => {
                      const formData = new FormData();
                      formData.append("step", "location");
                      formData.append("name", locationName);
                      formData.append("address", locationAddress);
                      formData.append("postcode", locationPostcode);
                      formData.append("timezone", locationTimezone);
                      formData.append("supportsDelivery", String(supportsDelivery));
                      formData.append("supportsPickup", String(supportsPickup));
                      if (locationLatitude) formData.append("latitude", locationLatitude);
                      if (locationLongitude) formData.append("longitude", locationLongitude);
                      handleStepComplete(STEPS.LOCATION, formData);
                    }}
                  >
                    Continue
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Step 3: Zone */}
        {currentStep === STEPS.ZONE && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  Create Your First Zone
                </Text>
                <Text as="p">
                  A zone defines the delivery or pickup area served by your location.
                </Text>

                {actionData && !actionData.success && (
                  <Banner tone="critical">
                    <Text as="p">{actionData.error || "An error occurred"}</Text>
                  </Banner>
                )}

                <FormLayout>
                  <TextField
                    label="Zone Name"
                    value={zoneName}
                    onChange={setZoneName}
                    placeholder="Central London"
                    autoComplete="off"
                    requiredIndicator
                  />

                  <Select
                    label="Zone Type"
                    options={[
                      { label: "Postcode Range", value: "postcode_range" },
                      { label: "Postcode List", value: "postcode_list" },
                      { label: "Radius (km)", value: "radius" },
                    ]}
                    value={zoneType}
                    onChange={setZoneType}
                  />

                  {zoneType === "postcode_range" && (
                    <InlineStack gap="400">
                      <TextField
                        label="Postcode Start"
                        value={postcodeStart}
                        onChange={setPostcodeStart}
                        placeholder="SW1A"
                        autoComplete="off"
                      />
                      <TextField
                        label="Postcode End"
                        value={postcodeEnd}
                        onChange={setPostcodeEnd}
                        placeholder="SW1Z"
                        autoComplete="off"
                      />
                    </InlineStack>
                  )}

                  {zoneType === "postcode_list" && (
                    <TextField
                      label="Postcodes (comma-separated)"
                      value={postcodes}
                      onChange={setPostcodes}
                      placeholder="SW1A 1AA, SW1A 2AA, EC1A 1BB"
                      autoComplete="off"
                      multiline={3}
                    />
                  )}

                  {zoneType === "radius" && (
                    <TextField
                      label="Radius (kilometers)"
                      type="number"
                      value={radiusKm}
                      onChange={setRadiusKm}
                      placeholder="10"
                      autoComplete="off"
                      suffix="km"
                    />
                  )}
                </FormLayout>

                <InlineStack align="space-between">
                  <Button onClick={() => setCurrentStep(STEPS.LOCATION)}>Back</Button>
                  <Button
                    variant="primary"
                    disabled={!zoneName || !createdLocationId}
                    onClick={() => {
                      const formData = new FormData();
                      formData.append("step", "zone");
                      formData.append("name", zoneName);
                      formData.append("zoneType", zoneType);
                      formData.append("locationId", createdLocationId);

                      if (zoneType === "postcode_range") {
                        formData.append("postcodeStart", postcodeStart);
                        formData.append("postcodeEnd", postcodeEnd);
                      } else if (zoneType === "postcode_list") {
                        formData.append("postcodes", postcodes);
                      } else if (zoneType === "radius") {
                        formData.append("radiusKm", radiusKm);
                      }

                      handleStepComplete(STEPS.ZONE, formData);
                    }}
                  >
                    Continue
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Step 4: Rules */}
        {currentStep === STEPS.RULES && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  Configure Business Rules
                </Text>
                <Text as="p">
                  Set up basic rules to control when customers can book delivery slots.
                </Text>

                {actionData && !actionData.success && (
                  <Banner tone="critical">
                    <Text as="p">{actionData.error || "An error occurred"}</Text>
                  </Banner>
                )}

                <FormLayout>
                  <Checkbox
                    label="Enable Order Cutoff Time"
                    helpText="Set a deadline for placing orders for a given delivery date"
                    checked={cutoffEnabled}
                    onChange={setCutoffEnabled}
                  />

                  {cutoffEnabled && (
                    <BlockStack gap="400">
                      <TextField
                        label="Cutoff Time"
                        type="time"
                        value={cutoffTime}
                        onChange={setCutoffTime}
                        autoComplete="off"
                      />
                      <TextField
                        label="Days Before Delivery"
                        type="number"
                        value={cutoffDaysBefore}
                        onChange={setCutoffDaysBefore}
                        helpText="e.g., 1 = cutoff applies the day before delivery"
                        autoComplete="off"
                        suffix="days"
                      />
                    </BlockStack>
                  )}

                  <Divider />

                  <Checkbox
                    label="Enable Minimum Lead Time"
                    helpText="Require orders to be placed a minimum number of days in advance"
                    checked={leadTimeEnabled}
                    onChange={setLeadTimeEnabled}
                  />

                  {leadTimeEnabled && (
                    <TextField
                      label="Minimum Lead Time"
                      type="number"
                      value={leadTimeDays}
                      onChange={setLeadTimeDays}
                      helpText="Minimum days between order placement and delivery"
                      autoComplete="off"
                      suffix="days"
                    />
                  )}
                </FormLayout>

                <InlineStack align="space-between">
                  <Button onClick={() => setCurrentStep(STEPS.ZONE)}>Back</Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      const formData = new FormData();
                      formData.append("step", "rules");
                      formData.append("cutoffEnabled", String(cutoffEnabled));
                      if (cutoffEnabled) {
                        formData.append("cutoffTime", cutoffTime);
                        formData.append("cutoffDaysBefore", cutoffDaysBefore);
                      }
                      formData.append("leadTimeEnabled", String(leadTimeEnabled));
                      if (leadTimeEnabled) {
                        formData.append("leadTimeDays", leadTimeDays);
                      }
                      handleStepComplete(STEPS.RULES, formData);
                    }}
                  >
                    Complete Setup
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Step 5: Complete */}
        {currentStep === STEPS.COMPLETE && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  Setup Complete! 🎉
                </Text>
                <Text as="p">
                  Your Ordak scheduling system is now configured and ready to use.
                </Text>

                <Banner tone="success">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">
                      What's been configured:
                    </Text>
                    <BlockStack gap="100">
                      <Text as="p">✓ Shop settings and recommendation weights</Text>
                      <Text as="p">✓ First location created</Text>
                      <Text as="p">✓ First delivery/pickup zone created</Text>
                      <Text as="p">✓ Business rules configured</Text>
                    </BlockStack>
                  </BlockStack>
                </Banner>

                <Text as="h3" variant="headingMd">
                  Next Steps:
                </Text>
                <BlockStack gap="200">
                  <Text as="p">1. Create delivery slots for your location</Text>
                  <Text as="p">2. Add more locations and zones as needed</Text>
                  <Text as="p">3. Configure additional rules (blackout dates, capacity limits)</Text>
                  <Text as="p">4. Test the customer booking experience</Text>
                </BlockStack>

                <InlineStack gap="300">
                  <Button variant="primary" onClick={() => navigate("/app")}>
                    Go to Dashboard
                  </Button>
                  <Button onClick={() => navigate("/app/locations")}>View Locations</Button>
                  <Button onClick={() => navigate("/app/zones")}>View Zones</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
