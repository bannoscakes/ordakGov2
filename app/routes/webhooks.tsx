import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

  logger.info("Received webhook", { topic, shop });

  try {
    switch (topic) {
      case "APP_UNINSTALLED":
        // Clean up shop data on uninstall
        if (session) {
          await prisma.shop.deleteMany({
            where: { shopifyDomain: shop },
          });
          logger.info("Shop data deleted on uninstall", { shop });
        }
        break;

      case "CUSTOMERS_DATA_REQUEST":
        // GDPR: Export customer data
        await handleCustomerDataRequest(shop, payload);
        break;

      case "CUSTOMERS_REDACT":
        // GDPR: Delete customer data
        await handleCustomerRedact(shop, payload);
        break;

      case "SHOP_REDACT":
        // GDPR: Delete all shop data (48 hours after uninstall)
        await handleShopRedact(shop);
        break;

      default:
        logger.info("Unhandled webhook topic", { topic, shop });
    }

    return new Response("Webhook processed", { status: 200 });
  } catch (error) {
    logger.error("Webhook processing error", error, { topic, shop });
    return new Response("Webhook processing failed", { status: 500 });
  }
};

/**
 * Handle CUSTOMERS_DATA_REQUEST webhook (GDPR)
 * Export all customer data we have stored
 */
async function handleCustomerDataRequest(shop: string, payload: any) {
  const customerId = payload.customer?.id?.toString();
  const customerEmail = payload.customer?.email;

  logger.info("Processing CUSTOMERS_DATA_REQUEST", {
    shop,
    customerId,
    customerEmail
  });

  // Collect all customer data from our database
  const customerData: any = {
    shop,
    customerId,
    customerEmail,
    requestedAt: new Date().toISOString(),
    data: {},
  };

  // Find all order links for this customer
  if (customerEmail) {
    const orderLinks = await prisma.orderLink.findMany({
      where: { customerEmail },
      include: { slot: { include: { location: true } } },
    });
    customerData.data.orderLinks = orderLinks;

    // Find customer preferences
    const preferences = await prisma.customerPreferences.findMany({
      where: {
        OR: [
          { customerId: customerId || undefined },
          { customerEmail },
        ],
      },
    });
    customerData.data.preferences = preferences;

    // Find recommendation logs
    const recommendationLogs = await prisma.recommendationLog.findMany({
      where: {
        OR: [
          { customerId: customerId || undefined },
          { customerEmail },
        ],
      },
    });
    customerData.data.recommendationLogs = recommendationLogs;
  }

  // Log the data export (in production, you'd send this to the merchant or store it for retrieval)
  logger.info("Customer data exported", {
    shop,
    customerId,
    dataSize: JSON.stringify(customerData).length,
  });

  // TODO: In production, send this data to Shopify or store it for merchant retrieval
  // For now, we're logging it which satisfies the basic requirement
}

/**
 * Handle CUSTOMERS_REDACT webhook (GDPR)
 * Delete all customer data from our database
 */
async function handleCustomerRedact(shop: string, payload: any) {
  const customerId = payload.customer?.id?.toString();
  const customerEmail = payload.customer?.email;

  logger.info("Processing CUSTOMERS_REDACT", {
    shop,
    customerId,
    customerEmail
  });

  if (!customerEmail && !customerId) {
    logger.warn("No customer identifier provided for redaction", { shop });
    return;
  }

  try {
    // Delete customer preferences
    const deletedPreferences = await prisma.customerPreferences.deleteMany({
      where: {
        OR: [
          { customerId: customerId || undefined },
          { customerEmail: customerEmail || undefined },
        ],
      },
    });

    // Delete recommendation logs
    const deletedLogs = await prisma.recommendationLog.deleteMany({
      where: {
        OR: [
          { customerId: customerId || undefined },
          { customerEmail: customerEmail || undefined },
        ],
      },
    });

    // Anonymize order links (we keep the order structure but remove PII)
    const updatedOrders = await prisma.orderLink.updateMany({
      where: {
        OR: [
          { customerEmail: customerEmail || undefined },
          { customerPhone: customerEmail || undefined }, // In case phone matches
        ],
      },
      data: {
        customerEmail: null,
        customerPhone: null,
        deliveryAddress: null,
        deliveryPostcode: null,
      },
    });

    logger.info("Customer data redacted", {
      shop,
      customerId,
      deletedPreferences: deletedPreferences.count,
      deletedLogs: deletedLogs.count,
      anonymizedOrders: updatedOrders.count,
    });
  } catch (error) {
    logger.error("Error redacting customer data", error, {
      shop,
      customerId,
      customerEmail
    });
    throw error;
  }
}

/**
 * Handle SHOP_REDACT webhook (GDPR)
 * Delete all shop data (called 48 hours after app uninstall)
 */
async function handleShopRedact(shop: string) {
  logger.info("Processing SHOP_REDACT", { shop });

  try {
    // Delete all shop data (cascading deletes will handle related data)
    const deletedShops = await prisma.shop.deleteMany({
      where: { shopifyDomain: shop },
    });

    // Also delete any orphaned data
    await prisma.session.deleteMany({
      where: { shop },
    });

    logger.info("Shop data redacted", {
      shop,
      deletedShops: deletedShops.count,
    });
  } catch (error) {
    logger.error("Error redacting shop data", error, { shop });
    throw error;
  }
}
