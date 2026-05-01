// TODO (post-upgrade): the original reschedule flow had discriminated-union
// narrowing issues and FormData typing mismatches. Will be restored in a
// dedicated PR once the cart-block work establishes the v1 reschedule UX.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({ orderId: params.orderId });
}

export default function Reschedule() {
  const { orderId } = useLoaderData<typeof loader>();
  return (
    <Page title={`Reschedule order ${orderId}`} backAction={{ content: "Orders", url: "/app/orders" }}>
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="Reschedule flow pending rebuild">
            <p>
              The admin reschedule UI is being rebuilt as part of the v1 release.
              Self-service customer rescheduling via <code>/api/reschedule</code>{" "}
              continues to work.
            </p>
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="p">Order: {orderId}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
