// One-off script: install our delivery-rate-filter Function as an active
// `deliveryCustomization` on the dev store via Admin GraphQL.
//
// In production this should be done from an admin UI route (Phase D), but
// for the dev-store smoke test we just call the mutation directly using
// the access token Prisma's session store already has.
//
// Usage:
//   node scripts/install-delivery-customization.mjs
//   SHOP=other.myshopify.com node scripts/install-delivery-customization.mjs
//
// Idempotent: skips if a deliveryCustomization referencing our function
// already exists.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SHOP = process.env.SHOP ?? "ordak-go-dev.myshopify.com";
const API_VERSION = "2026-04";
const FUNCTION_TITLE = "Ordak Go — hide rates by cart-stage choice";

async function gql(shop, accessToken, query, variables = {}) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors, null, 2)}`);
  }
  return body.data;
}

async function main() {
  const session = await prisma.session.findFirst({
    where: { shop: SHOP },
    orderBy: { expires: { sort: "desc", nulls: "last" } },
  });
  if (!session?.accessToken) {
    throw new Error(`No session token for ${SHOP}. Install the app first.`);
  }
  const accessToken = session.accessToken;
  console.log(`Using session for ${SHOP} (id=${session.id})`);

  // 1. Find our function in the app's installed Shopify Functions.
  const fnList = await gql(
    SHOP,
    accessToken,
    `query { shopifyFunctions(first: 25) { nodes { id title apiType app { title } } } }`,
  );
  const functions = fnList.shopifyFunctions.nodes;
  const ours = functions.find(
    (f) => f.apiType === "delivery_customization" && f.app?.title === "Ordak Go",
  );
  if (!ours) {
    console.error("Available Shopify Functions:", JSON.stringify(functions, null, 2));
    throw new Error(
      `No delivery_customization function found for app "Ordak Go". ` +
        `Run 'shopify app deploy' first to publish the function.`,
    );
  }
  console.log(`Found function: ${ours.title} (${ours.id})`);

  // 2. Idempotency: list existing deliveryCustomizations and skip if one
  //    references our function.
  const existing = await gql(
    SHOP,
    accessToken,
    `query { deliveryCustomizations(first: 25) { nodes { id title functionId enabled } } }`,
  );
  const dup = existing.deliveryCustomizations.nodes.find(
    (c) => c.functionId === ours.id,
  );
  if (dup) {
    console.log(
      `deliveryCustomization already exists: ${dup.title} (${dup.id}, enabled=${dup.enabled})`,
    );
    if (!dup.enabled) {
      const enable = await gql(
        SHOP,
        accessToken,
        `mutation($id: ID!, $deliveryCustomization: DeliveryCustomizationInput!) {
          deliveryCustomizationUpdate(id: $id, deliveryCustomization: $deliveryCustomization) {
            deliveryCustomization { id enabled }
            userErrors { field message }
          }
        }`,
        { id: dup.id, deliveryCustomization: { enabled: true } },
      );
      const errs = enable.deliveryCustomizationUpdate.userErrors;
      if (errs.length) throw new Error(`Enable failed: ${JSON.stringify(errs)}`);
      console.log(`Enabled existing customization.`);
    }
    return;
  }

  // 3. Create the deliveryCustomization referencing our function.
  const create = await gql(
    SHOP,
    accessToken,
    `mutation($deliveryCustomization: DeliveryCustomizationInput!) {
      deliveryCustomizationCreate(deliveryCustomization: $deliveryCustomization) {
        deliveryCustomization { id title enabled functionId }
        userErrors { field message }
      }
    }`,
    {
      deliveryCustomization: {
        functionId: ours.id,
        title: FUNCTION_TITLE,
        enabled: true,
      },
    },
  );
  const errs = create.deliveryCustomizationCreate.userErrors;
  if (errs.length) throw new Error(`Create failed: ${JSON.stringify(errs)}`);
  const installed = create.deliveryCustomizationCreate.deliveryCustomization;
  console.log(
    `Installed deliveryCustomization: ${installed.title} (${installed.id}, enabled=${installed.enabled})`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
