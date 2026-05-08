import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Banner,
  Button,
  Checkbox,
  FormLayout,
  InlineStack,
} from "@shopify/polaris";
import { useState } from "react";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { showRecommendedBadge: true, showMostAvailableBadge: true },
  });
  if (!shop) {
    throw new Response("Shop not found — reinstall the app", { status: 404 });
  }
  return json({ shop });
}

type ActionResult = { ok: true } | { ok: false; error: string };

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  try {
    const formData = await request.formData();
    const showRecommendedBadge = formData.get("showRecommendedBadge") === "true";
    const showMostAvailableBadge = formData.get("showMostAvailableBadge") === "true";
    await prisma.shop.update({
      where: { shopifyDomain: session.shop },
      data: { showRecommendedBadge, showMostAvailableBadge },
    });
    return redirect("/app/settings/widget-appearance?saved=1");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      logger.error("Widget appearance save: shop row missing", error, { shop: session.shop });
      return json<ActionResult>(
        { ok: false, error: "Shop record missing — please reinstall the app." },
        { status: 404 },
      );
    }
    logger.error("Widget appearance save failed", error, { shop: session.shop });
    return json<ActionResult>(
      { ok: false, error: "Save failed. Please try again." },
      { status: 500 },
    );
  }
}

export default function WidgetAppearance() {
  const { shop } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [showRecommendedBadge, setShowRecommendedBadge] = useState(shop.showRecommendedBadge);
  const [showMostAvailableBadge, setShowMostAvailableBadge] = useState(shop.showMostAvailableBadge);
  const [searchParams] = useSearchParams();

  const errorMessage = actionData && actionData.ok === false ? actionData.error : null;
  const justSaved = searchParams.get("saved") === "1";

  return (
    <Page
      title="Widget appearance"
      backAction={{ content: "Settings", url: "/app/settings" }}
    >
      <Layout>
        {errorMessage && (
          <Layout.Section>
            <Banner tone="critical">{errorMessage}</Banner>
          </Layout.Section>
        )}
        {justSaved && !errorMessage && (
          <Layout.Section>
            <Banner tone="success">Saved.</Banner>
          </Layout.Section>
        )}

        <Layout.AnnotatedSection
          title="Slot tile badges"
          description="Toggles for the labels that appear on time-slot tiles in the cart-block."
        >
          <Form method="post">
            <input type="hidden" name="showRecommendedBadge" value={showRecommendedBadge.toString()} />
            <input type="hidden" name="showMostAvailableBadge" value={showMostAvailableBadge.toString()} />
            <FormLayout>
              <Card>
                <BlockStack gap="400">
                  <Checkbox
                    label="Show RECOMMENDED badge"
                    helpText="Highlights slots with the highest recommendation score (orange star + border). Off by default — customers often find the ranking unclear."
                    checked={showRecommendedBadge}
                    onChange={setShowRecommendedBadge}
                  />
                  <Checkbox
                    label="Show 'Most available capacity' label"
                    helpText="Subtitle text on slots with the most spots remaining. On by default — surfaces useful capacity context without the orange-badge confusion."
                    checked={showMostAvailableBadge}
                    onChange={setShowMostAvailableBadge}
                  />
                </BlockStack>
              </Card>

              <InlineStack align="end">
                <Button variant="primary" submit loading={isLoading}>Save</Button>
              </InlineStack>
            </FormLayout>
          </Form>
        </Layout.AnnotatedSection>
      </Layout>
    </Page>
  );
}
