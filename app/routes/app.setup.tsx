// TODO (post-upgrade): the original setup wizard had multiple schema/validation
// drifts (postcode→postalCode, ruleType→type, RangeSlider signature,
// discriminated-union narrowing). Restoring it needs a UX/scope review.
// For now, this is a placeholder so the route resolves and merchants are pointed
// to the granular admin pages.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Button,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  return json({ shop: session.shop });
}

export default function Setup() {
  const { shop } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page title="Setup">
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="Setup wizard pending rebuild">
            <p>
              The guided setup wizard is being rebuilt as part of the v1
              release. In the meantime, configure your shop ({shop}) using
              the dedicated admin pages below.
            </p>
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">Manual setup checklist</Text>
              <Text as="p">1. Add at least one location</Text>
              <Button onClick={() => navigate("/app/locations/new")}>Add location</Button>
              <Text as="p">2. Add at least one delivery zone</Text>
              <Button onClick={() => navigate("/app/zones/new")}>Add zone</Button>
              <Text as="p">3. Configure business rules (cut-offs, lead times)</Text>
              <Button onClick={() => navigate("/app/rules/new")}>Add rule</Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
