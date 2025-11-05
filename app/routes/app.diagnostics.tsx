import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
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
  Badge,
  DataTable,
  Select,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface DiagnosticResult {
  status: "pass" | "warning" | "fail";
  message: string;
  details?: string;
  action?: string;
}

interface DiagnosticReport {
  timestamp: string;
  postcode?: string;
  fulfillmentType?: string;
  dateRange?: { from: string; to: string };
  checks: {
    slotsExist: DiagnosticResult;
    locationsConfigured: DiagnosticResult;
    zonesConfigured: DiagnosticResult;
    zonesCoverPostcode: DiagnosticResult;
    slotsHaveCapacity: DiagnosticResult;
    rulesActive: DiagnosticResult;
    slotsInDateRange: DiagnosticResult;
  };
  summary: {
    totalSlots: number;
    availableSlots: number;
    fullyBookedSlots: number;
    locations: number;
    zones: number;
    activeRules: number;
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const postcode = url.searchParams.get("postcode");
  const fulfillmentType = url.searchParams.get("fulfillmentType") || "delivery";
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const runDiagnostics = url.searchParams.get("run") === "true";

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    include: {
      locations: true,
      zones: {
        include: {
          location: true,
        },
      },
      rules: {
        where: { isActive: true },
      },
    },
  });

  if (!shop) {
    throw new Error("Shop not found");
  }

  let diagnosticReport: DiagnosticReport | null = null;

  if (runDiagnostics) {
    // Run diagnostics
    const now = new Date();
    const defaultDateFrom = new Date(now);
    defaultDateFrom.setDate(defaultDateFrom.getDate() + 1);
    const defaultDateTo = new Date(now);
    defaultDateTo.setDate(defaultDateTo.getDate() + 14);

    const searchDateFrom = dateFrom ? new Date(dateFrom) : defaultDateFrom;
    const searchDateTo = dateTo ? new Date(dateTo) : defaultDateTo;

    // Get all slots in date range
    const slots = await prisma.slot.findMany({
      where: {
        location: {
          shopId: shop.id,
          ...(fulfillmentType === "delivery"
            ? { supportsDelivery: true }
            : { supportsPickup: true }),
        },
        date: {
          gte: searchDateFrom,
          lte: searchDateTo,
        },
      },
      include: {
        location: {
          include: {
            zones: true,
          },
        },
      },
    });

    // Calculate metrics
    const totalSlots = slots.length;
    const availableSlots = slots.filter((s) => s.booked < s.capacity).length;
    const fullyBookedSlots = slots.filter((s) => s.booked >= s.capacity).length;

    // Check 1: Do slots exist?
    const slotsExist: DiagnosticResult = totalSlots > 0
      ? { status: "pass", message: `${totalSlots} slot(s) found in date range` }
      : {
          status: "fail",
          message: "No slots found",
          details: "You need to create delivery/pickup slots for your locations",
          action: "Create slots in Location management",
        };

    // Check 2: Are locations configured?
    const locationsCount = shop.locations.length;
    const relevantLocations = shop.locations.filter((loc) =>
      fulfillmentType === "delivery" ? loc.supportsDelivery : loc.supportsPickup
    );
    const locationsConfigured: DiagnosticResult =
      relevantLocations.length > 0
        ? {
            status: "pass",
            message: `${relevantLocations.length} location(s) support ${fulfillmentType}`,
          }
        : {
            status: "fail",
            message: `No locations configured for ${fulfillmentType}`,
            details: `You have ${locationsCount} location(s) but none support ${fulfillmentType}`,
            action: "Configure locations to support " + fulfillmentType,
          };

    // Check 3: Are zones configured?
    const zonesCount = shop.zones.length;
    const zonesConfigured: DiagnosticResult =
      zonesCount > 0
        ? { status: "pass", message: `${zonesCount} zone(s) configured` }
        : {
            status: "fail",
            message: "No zones configured",
            details: "Zones define which areas you can deliver to or offer pickup from",
            action: "Create zones for your locations",
          };

    // Check 4: Does a zone cover the postcode?
    let zonesCoverPostcode: DiagnosticResult = {
      status: "warning",
      message: "Postcode coverage check skipped",
      details: "Provide a postcode to check zone coverage",
    };

    if (postcode) {
      const matchingZones = shop.zones.filter((zone) => {
        if (zone.zoneType === "postcode_range" && zone.postcodeStart && zone.postcodeEnd) {
          const normalizedPostcode = postcode.replace(/\s/g, "").toUpperCase();
          const start = zone.postcodeStart.replace(/\s/g, "").toUpperCase();
          const end = zone.postcodeEnd.replace(/\s/g, "").toUpperCase();
          return normalizedPostcode >= start && normalizedPostcode <= end;
        } else if (zone.zoneType === "postcode_list" && zone.postcodes) {
          const normalizedPostcode = postcode.replace(/\s/g, "").toUpperCase();
          return zone.postcodes.some(
            (zp) => zp.replace(/\s/g, "").toUpperCase() === normalizedPostcode
          );
        }
        // Radius checks would require customer coordinates
        return false;
      });

      zonesCoverPostcode =
        matchingZones.length > 0
          ? {
              status: "pass",
              message: `Postcode ${postcode} is covered by ${matchingZones.length} zone(s)`,
              details: matchingZones.map((z) => z.name).join(", "),
            }
          : {
              status: "fail",
              message: `Postcode ${postcode} is not covered by any zones`,
              details: "Customer won't see any slots for this postcode",
              action: "Create or modify zones to include this postcode",
            };
    }

    // Check 5: Do slots have available capacity?
    const slotsHaveCapacity: DiagnosticResult =
      availableSlots > 0
        ? {
            status: "pass",
            message: `${availableSlots} slot(s) have available capacity`,
            details: `${fullyBookedSlots} slot(s) are fully booked`,
          }
        : totalSlots > 0
        ? {
            status: "warning",
            message: "All slots are fully booked",
            details: `${fullyBookedSlots} slot(s) are at capacity`,
            action: "Increase slot capacity or create more slots",
          }
        : {
            status: "warning",
            message: "No slots to check capacity",
          };

    // Check 6: Active rules
    const activeRulesCount = shop.rules.length;
    const rulesActive: DiagnosticResult = {
      status: "pass",
      message: `${activeRulesCount} active rule(s)`,
      details:
        activeRulesCount > 0
          ? shop.rules.map((r) => `${r.name} (${r.ruleType})`).join(", ")
          : "No business rules are restricting availability",
    };

    // Check 7: Slots in date range
    const slotsInDateRange: DiagnosticResult =
      totalSlots > 0
        ? {
            status: "pass",
            message: "Slots found in requested date range",
            details: `From ${searchDateFrom.toLocaleDateString()} to ${searchDateTo.toLocaleDateString()}`,
          }
        : {
            status: "warning",
            message: "No slots in requested date range",
            details: `Searched from ${searchDateFrom.toLocaleDateString()} to ${searchDateTo.toLocaleDateString()}`,
            action: "Create slots for this date range or adjust your search",
          };

    diagnosticReport = {
      timestamp: new Date().toISOString(),
      postcode: postcode || undefined,
      fulfillmentType,
      dateRange: {
        from: searchDateFrom.toISOString().split("T")[0],
        to: searchDateTo.toISOString().split("T")[0],
      },
      checks: {
        slotsExist,
        locationsConfigured,
        zonesConfigured,
        zonesCoverPostcode,
        slotsHaveCapacity,
        rulesActive,
        slotsInDateRange,
      },
      summary: {
        totalSlots,
        availableSlots,
        fullyBookedSlots,
        locations: locationsCount,
        zones: zonesCount,
        activeRules: activeRulesCount,
      },
    };
  }

  return json({
    shop: {
      shopifyDomain: shop.shopifyDomain,
    },
    diagnosticReport,
  });
}

export default function Diagnostics() {
  const { diagnosticReport } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [postcode, setPostcode] = useState(searchParams.get("postcode") || "");
  const [fulfillmentType, setFulfillmentType] = useState(
    searchParams.get("fulfillmentType") || "delivery"
  );

  // Default date range: tomorrow to 14 days from now
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const twoWeeksFromNow = new Date();
  twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

  const [dateFrom, setDateFrom] = useState(
    searchParams.get("dateFrom") || tomorrow.toISOString().split("T")[0]
  );
  const [dateTo, setDateTo] = useState(
    searchParams.get("dateTo") || twoWeeksFromNow.toISOString().split("T")[0]
  );

  const handleRunDiagnostics = () => {
    const params = new URLSearchParams();
    params.set("run", "true");
    if (postcode) params.set("postcode", postcode);
    params.set("fulfillmentType", fulfillmentType);
    params.set("dateFrom", dateFrom);
    params.set("dateTo", dateTo);
    setSearchParams(params);
  };

  const getStatusBadge = (status: "pass" | "warning" | "fail") => {
    switch (status) {
      case "pass":
        return <Badge tone="success">Pass</Badge>;
      case "warning":
        return <Badge tone="warning">Warning</Badge>;
      case "fail":
        return <Badge tone="critical">Fail</Badge>;
    }
  };

  return (
    <Page
      title="Slot Diagnostics"
      subtitle="Troubleshoot why customers might not see available slots"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Run Diagnostics
              </Text>
              <Text as="p" tone="subdued">
                This tool helps you understand why slots might not be appearing for customers.
                Enter customer details to simulate their experience.
              </Text>

              <FormLayout>
                <TextField
                  label="Customer Postcode (Optional)"
                  value={postcode}
                  onChange={setPostcode}
                  placeholder="SW1A 1AA"
                  helpText="Check if this postcode is covered by your zones"
                  autoComplete="off"
                />

                <Select
                  label="Fulfillment Type"
                  options={[
                    { label: "Delivery", value: "delivery" },
                    { label: "Pickup", value: "pickup" },
                  ]}
                  value={fulfillmentType}
                  onChange={setFulfillmentType}
                />

                <InlineStack gap="400">
                  <TextField
                    label="Date From"
                    type="date"
                    value={dateFrom}
                    onChange={setDateFrom}
                    autoComplete="off"
                  />
                  <TextField
                    label="Date To"
                    type="date"
                    value={dateTo}
                    onChange={setDateTo}
                    autoComplete="off"
                  />
                </InlineStack>

                <Button variant="primary" onClick={handleRunDiagnostics}>
                  Run Diagnostics
                </Button>
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        {diagnosticReport && (
          <>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Diagnostic Results
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {new Date(diagnosticReport.timestamp).toLocaleString()}
                    </Text>
                  </InlineStack>

                  {diagnosticReport.postcode && (
                    <Text as="p" tone="subdued">
                      Testing for postcode: <strong>{diagnosticReport.postcode}</strong>
                    </Text>
                  )}
                  <Text as="p" tone="subdued">
                    Fulfillment type: <strong>{diagnosticReport.fulfillmentType}</strong>
                  </Text>
                  <Text as="p" tone="subdued">
                    Date range: <strong>{diagnosticReport.dateRange?.from}</strong> to{" "}
                    <strong>{diagnosticReport.dateRange?.to}</strong>
                  </Text>

                  <Divider />

                  <Text as="h3" variant="headingSm">
                    Quick Summary
                  </Text>
                  <InlineStack gap="400">
                    <Badge tone="info">{diagnosticReport.summary.totalSlots} Total Slots</Badge>
                    <Badge tone="success">
                      {diagnosticReport.summary.availableSlots} Available
                    </Badge>
                    <Badge tone="warning">
                      {diagnosticReport.summary.fullyBookedSlots} Fully Booked
                    </Badge>
                  </InlineStack>
                  <InlineStack gap="400">
                    <Badge>{diagnosticReport.summary.locations} Locations</Badge>
                    <Badge>{diagnosticReport.summary.zones} Zones</Badge>
                    <Badge>{diagnosticReport.summary.activeRules} Active Rules</Badge>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Diagnostic Checks
                  </Text>

                  {/* Check: Slots Exist */}
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="start">
                        <Text as="p" fontWeight="semibold">
                          Slots Created
                        </Text>
                        {getStatusBadge(diagnosticReport.checks.slotsExist.status)}
                      </InlineStack>
                      <Text as="p">{diagnosticReport.checks.slotsExist.message}</Text>
                      {diagnosticReport.checks.slotsExist.details && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {diagnosticReport.checks.slotsExist.details}
                        </Text>
                      )}
                      {diagnosticReport.checks.slotsExist.action && (
                        <Banner tone="info">
                          <Text as="p" fontWeight="semibold">
                            Action Required:
                          </Text>
                          <Text as="p">{diagnosticReport.checks.slotsExist.action}</Text>
                        </Banner>
                      )}
                    </BlockStack>
                  </Card>

                  {/* Check: Locations Configured */}
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="start">
                        <Text as="p" fontWeight="semibold">
                          Locations Configured
                        </Text>
                        {getStatusBadge(diagnosticReport.checks.locationsConfigured.status)}
                      </InlineStack>
                      <Text as="p">{diagnosticReport.checks.locationsConfigured.message}</Text>
                      {diagnosticReport.checks.locationsConfigured.details && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {diagnosticReport.checks.locationsConfigured.details}
                        </Text>
                      )}
                      {diagnosticReport.checks.locationsConfigured.action && (
                        <Banner tone="info">
                          <Text as="p" fontWeight="semibold">
                            Action Required:
                          </Text>
                          <Text as="p">{diagnosticReport.checks.locationsConfigured.action}</Text>
                        </Banner>
                      )}
                    </BlockStack>
                  </Card>

                  {/* Check: Zones Configured */}
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="start">
                        <Text as="p" fontWeight="semibold">
                          Zones Configured
                        </Text>
                        {getStatusBadge(diagnosticReport.checks.zonesConfigured.status)}
                      </InlineStack>
                      <Text as="p">{diagnosticReport.checks.zonesConfigured.message}</Text>
                      {diagnosticReport.checks.zonesConfigured.details && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {diagnosticReport.checks.zonesConfigured.details}
                        </Text>
                      )}
                      {diagnosticReport.checks.zonesConfigured.action && (
                        <Banner tone="info">
                          <Text as="p" fontWeight="semibold">
                            Action Required:
                          </Text>
                          <Text as="p">{diagnosticReport.checks.zonesConfigured.action}</Text>
                        </Banner>
                      )}
                    </BlockStack>
                  </Card>

                  {/* Check: Zones Cover Postcode */}
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="start">
                        <Text as="p" fontWeight="semibold">
                          Postcode Coverage
                        </Text>
                        {getStatusBadge(diagnosticReport.checks.zonesCoverPostcode.status)}
                      </InlineStack>
                      <Text as="p">{diagnosticReport.checks.zonesCoverPostcode.message}</Text>
                      {diagnosticReport.checks.zonesCoverPostcode.details && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {diagnosticReport.checks.zonesCoverPostcode.details}
                        </Text>
                      )}
                      {diagnosticReport.checks.zonesCoverPostcode.action && (
                        <Banner tone="info">
                          <Text as="p" fontWeight="semibold">
                            Action Required:
                          </Text>
                          <Text as="p">{diagnosticReport.checks.zonesCoverPostcode.action}</Text>
                        </Banner>
                      )}
                    </BlockStack>
                  </Card>

                  {/* Check: Slots Have Capacity */}
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="start">
                        <Text as="p" fontWeight="semibold">
                          Available Capacity
                        </Text>
                        {getStatusBadge(diagnosticReport.checks.slotsHaveCapacity.status)}
                      </InlineStack>
                      <Text as="p">{diagnosticReport.checks.slotsHaveCapacity.message}</Text>
                      {diagnosticReport.checks.slotsHaveCapacity.details && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {diagnosticReport.checks.slotsHaveCapacity.details}
                        </Text>
                      )}
                      {diagnosticReport.checks.slotsHaveCapacity.action && (
                        <Banner tone="info">
                          <Text as="p" fontWeight="semibold">
                            Action Required:
                          </Text>
                          <Text as="p">{diagnosticReport.checks.slotsHaveCapacity.action}</Text>
                        </Banner>
                      )}
                    </BlockStack>
                  </Card>

                  {/* Check: Active Rules */}
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="start">
                        <Text as="p" fontWeight="semibold">
                          Business Rules
                        </Text>
                        {getStatusBadge(diagnosticReport.checks.rulesActive.status)}
                      </InlineStack>
                      <Text as="p">{diagnosticReport.checks.rulesActive.message}</Text>
                      {diagnosticReport.checks.rulesActive.details && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {diagnosticReport.checks.rulesActive.details}
                        </Text>
                      )}
                    </BlockStack>
                  </Card>

                  {/* Check: Slots in Date Range */}
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="start">
                        <Text as="p" fontWeight="semibold">
                          Date Range Coverage
                        </Text>
                        {getStatusBadge(diagnosticReport.checks.slotsInDateRange.status)}
                      </InlineStack>
                      <Text as="p">{diagnosticReport.checks.slotsInDateRange.message}</Text>
                      {diagnosticReport.checks.slotsInDateRange.details && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {diagnosticReport.checks.slotsInDateRange.details}
                        </Text>
                      )}
                      {diagnosticReport.checks.slotsInDateRange.action && (
                        <Banner tone="info">
                          <Text as="p" fontWeight="semibold">
                            Action Required:
                          </Text>
                          <Text as="p">{diagnosticReport.checks.slotsInDateRange.action}</Text>
                        </Banner>
                      )}
                    </BlockStack>
                  </Card>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Troubleshooting Guide
                  </Text>
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text as="p" fontWeight="semibold">
                        Why are no slots appearing?
                      </Text>
                      <Text as="p" variant="bodySm">
                        1. Ensure slots are created for your locations
                      </Text>
                      <Text as="p" variant="bodySm">
                        2. Check that locations support the requested fulfillment type
                      </Text>
                      <Text as="p" variant="bodySm">
                        3. Verify zones cover the customer's postcode
                      </Text>
                      <Text as="p" variant="bodySm">
                        4. Confirm slots are not fully booked
                      </Text>
                    </BlockStack>

                    <BlockStack gap="100">
                      <Text as="p" fontWeight="semibold">
                        Why are all slots showing as unavailable?
                      </Text>
                      <Text as="p" variant="bodySm">
                        1. Check if slots are fully booked (booked ≥ capacity)
                      </Text>
                      <Text as="p" variant="bodySm">
                        2. Review business rules (cutoff times, lead times, blackout dates)
                      </Text>
                      <Text as="p" variant="bodySm">
                        3. Increase slot capacity or create additional slots
                      </Text>
                    </BlockStack>

                    <BlockStack gap="100">
                      <Text as="p" fontWeight="semibold">
                        How do I fix postcode coverage issues?
                      </Text>
                      <Text as="p" variant="bodySm">
                        1. Edit existing zones to expand postcode ranges
                      </Text>
                      <Text as="p" variant="bodySm">
                        2. Create new zones for uncovered areas
                      </Text>
                      <Text as="p" variant="bodySm">
                        3. Consider using radius-based zones for broader coverage
                      </Text>
                    </BlockStack>
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}
