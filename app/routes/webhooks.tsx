import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case "APP_UNINSTALLED":
      // Clean up shop data on uninstall
      if (session) {
        await prisma.shop.deleteMany({
          where: { shopifyDomain: shop },
        });
      }
      break;
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
    case "SHOP_REDACT":
    default:
      console.log("Unhandled webhook topic:", topic);
  }

  return new Response("Webhook processed", { status: 200 });
};
