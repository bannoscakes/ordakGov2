import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

  logger.info("Received webhook", { topic, shop });

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
      logger.info("Unhandled webhook topic", { topic, shop });
  }

  return new Response("Webhook processed", { status: 200 });
};
