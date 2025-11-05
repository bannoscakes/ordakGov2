/**
 * Create New Rule Page
 * Form to create a new scheduling rule
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Select,
  Checkbox,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  return json({ shop });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const name = formData.get("name") as string;
  const type = formData.get("type") as string;
  const isActive = formData.get("isActive") === "true";

  // Validation
  if (!name || !type) {
    return json(
      { error: "Name and rule type are required" },
      { status: 400 }
    );
  }

  // Type-specific validation and data preparation
  let cutoffTime: string | null = null;
  let leadTimeHours: number | null = null;
  let leadTimeDays: number | null = null;
  let blackoutDates: Date[] = [];
  let slotDuration: number | null = null;
  let slotCapacity: number | null = null;

  switch (type) {
    case "cutoff": {
      cutoffTime = formData.get("cutoffTime") as string;
      if (!cutoffTime || cutoffTime.trim() === "") {
        return json(
          { error: "Please enter a cut-off time (e.g., 14:00)" },
          { status: 400 }
        );
      }
      // Validate time format (HH:MM)
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(cutoffTime)) {
        return json(
          { error: "Cut-off time must be in HH:MM format (e.g., 14:00)" },
          { status: 400 }
        );
      }
      break;
    }

    case "lead_time": {
      const hoursInput = formData.get("leadTimeHours") as string;
      const daysInput = formData.get("leadTimeDays") as string;

      if (hoursInput) {
        leadTimeHours = parseInt(hoursInput);
        if (isNaN(leadTimeHours) || leadTimeHours < 0) {
          return json(
            { error: "Lead time hours must be a non-negative number" },
            { status: 400 }
          );
        }
      }

      if (daysInput) {
        leadTimeDays = parseInt(daysInput);
        if (isNaN(leadTimeDays) || leadTimeDays < 0) {
          return json(
            { error: "Lead time days must be a non-negative number" },
            { status: 400 }
          );
        }
      }

      if (!leadTimeHours && !leadTimeDays) {
        return json(
          { error: "Please enter either hours or days for lead time" },
          { status: 400 }
        );
      }
      break;
    }

    case "blackout": {
      const datesInput = formData.get("blackoutDates") as string;
      if (!datesInput || datesInput.trim() === "") {
        return json(
          { error: "Please enter at least one blackout date" },
          { status: 400 }
        );
      }

      // Parse dates (comma-separated YYYY-MM-DD format)
      const dateStrings = datesInput
        .split(",")
        .map((d) => d.trim())
        .filter((d) => d.length > 0);

      for (const dateStr of dateStrings) {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
          return json(
            { error: `Invalid date format: ${dateStr}. Please use YYYY-MM-DD format.` },
            { status: 400 }
          );
        }
        blackoutDates.push(date);
      }

      if (blackoutDates.length === 0) {
        return json(
          { error: "Please enter at least one valid blackout date" },
          { status: 400 }
        );
      }
      break;
    }

    case "capacity": {
      const durationInput = formData.get("slotDuration") as string;
      const capacityInput = formData.get("slotCapacity") as string;

      if (!durationInput || !capacityInput) {
        return json(
          { error: "Please enter both slot duration and capacity" },
          { status: 400 }
        );
      }

      slotDuration = parseInt(durationInput);
      slotCapacity = parseInt(capacityInput);

      if (isNaN(slotDuration) || slotDuration <= 0) {
        return json(
          { error: "Slot duration must be a positive number" },
          { status: 400 }
        );
      }

      if (isNaN(slotCapacity) || slotCapacity <= 0) {
        return json(
          { error: "Slot capacity must be a positive number" },
          { status: 400 }
        );
      }
      break;
    }

    default:
      return json(
        { error: "Invalid rule type" },
        { status: 400 }
      );
  }

  // Create rule
  try {
    await prisma.rule.create({
      data: {
        shopId: shop.id,
        name,
        type,
        cutoffTime,
        leadTimeHours,
        leadTimeDays,
        blackoutDates,
        slotDuration,
        slotCapacity,
        isActive,
      },
    });

    return redirect("/app/rules");
  } catch (error) {
    return json(
      { error: "Failed to create rule" },
      { status: 500 }
    );
  }
}

export default function NewRule() {
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [name, setName] = useState("");
  const [type, setType] = useState("cutoff");
  const [cutoffTime, setCutoffTime] = useState("");
  const [leadTimeHours, setLeadTimeHours] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [blackoutDates, setBlackoutDates] = useState("");
  const [slotDuration, setSlotDuration] = useState("");
  const [slotCapacity, setSlotCapacity] = useState("");
  const [isActive, setIsActive] = useState(true);

  const typeOptions = [
    { label: "Cut-off Time", value: "cutoff" },
    { label: "Lead Time", value: "lead_time" },
    { label: "Blackout Dates", value: "blackout" },
    { label: "Capacity", value: "capacity" },
  ];

  return (
    <Page
      title="Create Scheduling Rule"
      backAction={{ content: "Rules", url: "/app/rules" }}
    >
      <Layout>
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical">{actionData.error}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <form method="post">
            <FormLayout>
              <Card>
                <BlockStack gap="400">
                  <TextField
                    label="Rule Name"
                    name="name"
                    value={name}
                    onChange={setName}
                    placeholder="e.g., Same-day cut-off at 2pm"
                    autoComplete="off"
                    requiredIndicator
                  />

                  <Select
                    label="Rule Type"
                    name="type"
                    options={typeOptions}
                    value={type}
                    onChange={setType}
                    helpText="What type of scheduling constraint do you want to add?"
                    requiredIndicator
                  />
                </BlockStack>
              </Card>

              {/* Conditional fields based on rule type */}
              {type === "cutoff" && (
                <Card>
                  <BlockStack gap="400">
                    <div>
                      <Text as="h3" variant="headingMd">
                        Cut-off Time
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Set the latest time customers can order for same-day delivery/pickup
                      </Text>
                    </div>
                    <TextField
                      label="Cut-off Time"
                      name="cutoffTime"
                      value={cutoffTime}
                      onChange={setCutoffTime}
                      placeholder="14:00"
                      type="time"
                      autoComplete="off"
                      helpText="Orders placed after this time will not be eligible for same-day slots"
                      requiredIndicator
                    />
                    <Banner tone="info">
                      Example: If you set 14:00, customers ordering at 2:01pm won't see slots for today.
                    </Banner>
                  </BlockStack>
                </Card>
              )}

              {type === "lead_time" && (
                <Card>
                  <BlockStack gap="400">
                    <div>
                      <Text as="h3" variant="headingMd">
                        Lead Time
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Set minimum advance notice required before delivery/pickup
                      </Text>
                    </div>
                    <InlineStack gap="400">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Days"
                          name="leadTimeDays"
                          value={leadTimeDays}
                          onChange={setLeadTimeDays}
                          type="number"
                          min="0"
                          placeholder="e.g., 1"
                          autoComplete="off"
                          helpText="Minimum days in advance"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Hours"
                          name="leadTimeHours"
                          value={leadTimeHours}
                          onChange={setLeadTimeHours}
                          type="number"
                          min="0"
                          placeholder="e.g., 24"
                          autoComplete="off"
                          helpText="Minimum hours in advance"
                        />
                      </div>
                    </InlineStack>
                    <Banner tone="info">
                      Example: Setting 24 hours means customers must order at least 24 hours before their chosen slot.
                    </Banner>
                  </BlockStack>
                </Card>
              )}

              {type === "blackout" && (
                <Card>
                  <BlockStack gap="400">
                    <div>
                      <Text as="h3" variant="headingMd">
                        Blackout Dates
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Specify dates when no delivery or pickup is available
                      </Text>
                    </div>
                    <TextField
                      label="Blackout Dates"
                      name="blackoutDates"
                      value={blackoutDates}
                      onChange={setBlackoutDates}
                      placeholder="e.g., 2025-12-25, 2025-12-26, 2025-01-01"
                      multiline={3}
                      autoComplete="off"
                      helpText="Enter dates in YYYY-MM-DD format, separated by commas"
                      requiredIndicator
                    />
                    <Banner tone="info">
                      Use this for holidays, maintenance days, or any dates when you can't fulfill orders.
                    </Banner>
                  </BlockStack>
                </Card>
              )}

              {type === "capacity" && (
                <Card>
                  <BlockStack gap="400">
                    <div>
                      <Text as="h3" variant="headingMd">
                        Slot Capacity
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Define how long slots are and how many orders each slot can handle
                      </Text>
                    </div>
                    <InlineStack gap="400">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Slot Duration (minutes)"
                          name="slotDuration"
                          value={slotDuration}
                          onChange={setSlotDuration}
                          type="number"
                          min="1"
                          placeholder="e.g., 60"
                          autoComplete="off"
                          helpText="How long is each time slot?"
                          requiredIndicator
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Max Orders per Slot"
                          name="slotCapacity"
                          value={slotCapacity}
                          onChange={setSlotCapacity}
                          type="number"
                          min="1"
                          placeholder="e.g., 10"
                          autoComplete="off"
                          helpText="Maximum concurrent orders"
                          requiredIndicator
                        />
                      </div>
                    </InlineStack>
                    <Banner tone="info">
                      Example: 60-minute slots with 10 orders max means you can handle 10 deliveries/pickups per hour.
                    </Banner>
                  </BlockStack>
                </Card>
              )}

              <Card>
                <Checkbox
                  label="Active"
                  checked={isActive}
                  onChange={setIsActive}
                  helpText="Only active rules are enforced during slot booking"
                />
                <input
                  type="hidden"
                  name="isActive"
                  value={isActive.toString()}
                />
              </Card>

              <InlineStack align="end" gap="200">
                <Button onClick={() => navigate("/app/rules")}>Cancel</Button>
                <Button variant="primary" submit loading={isLoading}>
                  Create Rule
                </Button>
              </InlineStack>
            </FormLayout>
          </form>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
