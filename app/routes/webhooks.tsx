import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { unregisterCarrierService } from "../services/carrier-service.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

  logger.info("Received webhook", { topic, shop });

  try {
    switch (topic) {
      case "APP_UNINSTALLED":
        // Decoupled cleanup: the carrier-service unregister and the Shop
        // delete are independent. Shopify can revoke the access token
        // before sending APP_UNINSTALLED, in which case `admin` is
        // undefined — but we still need to delete the Shop row, otherwise
        // a future reinstall hits afterAuth's `if (!dbShop.carrierServiceId)`
        // guard with the OLD ID, skips registration, and the merchant
        // ends up with no shipping options at checkout.
        if (session) {
          // Best-effort unregister (only if we have admin context AND a
          // stored ID). Failures are logged distinctly so operators can
          // tell "already gone, benign" from "real error, possible orphan."
          if (admin) {
            const dbShop = await prisma.shop.findUnique({
              where: { shopifyDomain: shop },
              select: { carrierServiceId: true },
            });
            if (dbShop?.carrierServiceId) {
              const ok = await unregisterCarrierService(
                admin.graphql,
                dbShop.carrierServiceId,
              );
              if (ok) {
                logger.info("Carrier service unregistered on uninstall", {
                  shop,
                  id: dbShop.carrierServiceId,
                });
              } else {
                // Could be already-deleted on Shopify's side (benign) or
                // a real failure (orphan registration left pointing at
                // our now-dead callback). Log loud so it's grep-able.
                logger.error(
                  "Carrier service unregister failed; possible orphan registration on Shopify side",
                  undefined,
                  { shop, id: dbShop.carrierServiceId },
                );
              }
            }
          }

          // Always delete the Shop row regardless of unregister outcome
          // or admin availability — leaving it would block re-registration
          // on the next install.
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
 *
 * Shopify forwards a customer's GDPR Subject Access Request to the app.
 * The app's responsibility is to make the requested data available to
 * the merchant within 30 days, who then forwards it to the customer.
 *
 * This handler:
 * 1. Authenticates the HMAC (already done by authenticate.webhook upstream).
 * 2. Logs a structured `gdpr.data_request_received` event with the
 *    customer identifiers — this is the audit trail that proves we
 *    received the request, queryable in Vercel runtime logs.
 * 3. Counts the data we hold for that customer so the merchant can
 *    see at-a-glance whether anything needs to be exported.
 * 4. Returns 200 — Shopify retries the webhook on non-2xx, which would
 *    spam the audit trail.
 *
 * The actual data delivery to the merchant happens via the admin route
 * `/app/data-requests`: the merchant pastes the customer's email or
 * Shopify customer ID, we re-run the same queries this handler runs,
 * and surface the results as a JSON payload the merchant can download
 * and forward to the customer.
 *
 * No DB table is required to track requests because:
 *   (a) Vercel runtime logs already provide the audit trail (queryable
 *       by `gdpr.data_request_received` + customer identifier).
 *   (b) The data itself is re-derived on demand from existing tables
 *       (OrderLink, CustomerPreferences, RecommendationLog) — adding a
 *       snapshot table would just create a stale duplicate.
 *
 * If this app's storage architecture later includes append-only state
 * that can't be reconstructed from current tables, this handler will
 * need to persist the snapshot. For now (2026-05-05), all PII lives in
 * tables that can be queried by customer email/id directly.
 */
async function handleCustomerDataRequest(shop: string, payload: any) {
  const customerId = payload.customer?.id?.toString() ?? null;
  const customerEmail = payload.customer?.email ?? null;
  const requestedAt = new Date().toISOString();

  // Resolve shop row up front so all count queries can scope by shopId
  // (F6 fix). Without this, OrderLink + CustomerPreferences counts would
  // sum across every installed tenant whose customer shares this email,
  // disclosing cross-tenant data in the merchant-visible audit log.
  const shopRecord = await prisma.shop
    .findUnique({ where: { shopifyDomain: shop }, select: { id: true } })
    .catch(() => null);

  // Count what we hold for this customer — the audit log line is the
  // primary reviewer-visible artifact, so make it self-contained.
  //
  // CRITICAL: a count-query failure must NOT propagate. The outer
  // try/catch in `action` would return 500, Shopify treats that as
  // delivery failure and retries with exponential backoff for up to
  // 48 hours, spamming the audit trail and overwhelming the DB. The
  // legally important artifact is "we received this webhook"; counts
  // are diagnostic. Wrap separately, log on failure, fall through to
  // the audit log with `null` counts, return 200.
  let counts: {
    orderLinks: number | null;
    preferences: number | null;
    recommendationLogs: number | null;
  } = { orderLinks: null, preferences: null, recommendationLogs: null };
  let countError: string | null = null;

  if ((customerEmail || customerId) && shopRecord) {
    try {
      const emailOrId: Array<{ customerEmail: string } | { customerId: string }> = [];
      if (customerEmail) emailOrId.push({ customerEmail });
      if (customerId) emailOrId.push({ customerId });

      const [orderLinkCount, preferenceCount, recommendationLogCount] = await Promise.all([
        customerEmail
          ? prisma.orderLink.count({
              where: {
                customerEmail,
                slot: { location: { shopId: shopRecord.id } },
              },
            })
          : Promise.resolve(0),
        prisma.customerPreferences.count({
          where: { shopId: shopRecord.id, OR: emailOrId },
        }),
        prisma.recommendationLog.count({
          where: { AND: [{ shopifyDomain: shop }, { OR: emailOrId }] },
        }),
      ]);
      counts = {
        orderLinks: orderLinkCount,
        preferences: preferenceCount,
        recommendationLogs: recommendationLogCount,
      };
    } catch (err) {
      countError = err instanceof Error ? err.message : String(err);
      logger.error("gdpr.data_request_count_failed", err, { shop, customerId, customerEmail });
      // Continue — audit log still fires below. Receipt is the legally
      // important artifact, not the counts.
    }
  }

  // Structured audit log. Vercel runtime logs are queryable via the
  // `gdpr.data_request_received` substring. Captures shop + customer
  // identifiers + counts so the merchant can prove receipt without a
  // separate persistence layer. `countsUnavailable` is set when the
  // count queries failed; the merchant can still re-run the export
  // manually via /app/data-requests.
  logger.info("gdpr.data_request_received", {
    shop,
    customerId,
    customerEmail,
    requestedAt,
    counts,
    countsUnavailable: countError,
    fulfillmentInstructions:
      `Merchant should visit /app/data-requests on the Ordak Go admin, ` +
      `enter the customer's email or Shopify customer id, download the ` +
      `JSON export, and forward it to the customer.`,
  });
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

  // Resolve shop row so every delete/update can be scoped (F6 fix). A
  // null shopRecord means the shop is already gone — log + bail rather
  // than fall through to unscoped deletes that would cross tenants.
  const shopRecord = await prisma.shop
    .findUnique({ where: { shopifyDomain: shop }, select: { id: true } })
    .catch(() => null);
  if (!shopRecord) {
    logger.warn("gdpr.customer_redact_skipped_unknown_shop", { shop });
    return;
  }

  try {
    // Delete customer preferences scoped to this shop only. Without the
    // shopId guard, an attacker installing the app on a Partner store
    // could trigger a redact for a high-value customer email and wipe
    // that customer's preferences across every other shop running this
    // app — the headline F6 finding.
    const deletedPreferences = await prisma.customerPreferences.deleteMany({
      where: {
        shopId: shopRecord.id,
        OR: [
          { customerId: customerId || undefined },
          { customerEmail: customerEmail || undefined },
        ],
      },
    });

    // Delete recommendation logs scoped to this shop only. RecommendationLog
    // has shopifyDomain natively (unlike CustomerPreferences which gained
    // shopId only via this fix), so we scope on that.
    const deletedLogs = await prisma.recommendationLog.deleteMany({
      where: {
        shopifyDomain: shop,
        OR: [
          { customerId: customerId || undefined },
          { customerEmail: customerEmail || undefined },
        ],
      },
    });

    // Anonymize order links (we keep the order structure but remove PII).
    // Scoped via slot.location.shopId so anonymizing a redact-target's
    // address at shop A doesn't also anonymize a same-email customer's
    // unrelated order at shop B.
    //
    // BUG FIX (PR #79 review): the previous version had
    // `{ customerPhone: customerEmail || undefined }` — comparing the
    // OrderLink.customerPhone field against the email value, which by
    // construction can never match. That left phone numbers
    // un-redacted, a GDPR compliance failure. Removed entirely:
    // Shopify's customers/redact payload only provides email + id,
    // never a phone number, so there's no phone-based join available.
    // Phone is still anonymized via `data: { customerPhone: null }`
    // for any row matched on customerEmail.
    const updatedOrders = await prisma.orderLink.updateMany({
      where: {
        customerEmail: customerEmail || undefined,
        slot: { location: { shopId: shopRecord.id } },
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
    // Log loud but DO NOT rethrow. Returning 5xx here triggers Shopify's
    // exponential-backoff retry storm against our DB exactly when it's
    // most likely to be in a degraded state. The legally-important
    // artifact is "we received this webhook + attempted redaction" — the
    // log line below is that artifact. Same fail-open pattern as
    // handleCustomerDataRequest's count failure path.
    logger.error("gdpr.customer_redact_failed_falling_open", error, {
      shop,
      customerId,
      customerEmail,
    });
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
    // Log loud but DO NOT rethrow. SHOP_REDACT fires 48 hours after
    // uninstall, when the shop row is typically already deleted by
    // APP_UNINSTALLED — a NotFound here is benign. Returning 5xx would
    // trigger Shopify's retry storm for 48+ hours. The log line is the
    // legally-important artifact.
    logger.error("gdpr.shop_redact_failed_falling_open", error, { shop });
  }
}
