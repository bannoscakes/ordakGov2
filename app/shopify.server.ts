import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { getEnv } from "./utils/env.server";
import { logger } from "./utils/logger.server";
import {
  buildCallbackUrl,
  registerCarrierService,
} from "./services/carrier-service.server";

const env = getEnv();
const API_VERSION = ApiVersion.April26;

/**
 * Build a fetch-based admin GraphQL caller compatible with the
 * `graphql: any` shape used by app/services/*.server.ts. Used from
 * afterAuth where we have a session.accessToken but no request context to
 * call `authenticate.admin(request)` on.
 */
function adminGraphqlFn(shop: string, accessToken: string) {
  return async (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) =>
    fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: options?.variables }),
    });
}

const shopify = shopifyApp({
  apiKey: env.SHOPIFY_API_KEY,
  apiSecretKey: env.SHOPIFY_API_SECRET,
  // Pinned to the current quarter (April 2026). Bumped quarterly via the
  // scheduled stack-rot defense agent — see memory/stack_rot_defense.md.
  apiVersion: ApiVersion.April26,
  scopes: env.SCOPES.split(","),
  appUrl: env.SHOPIFY_APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
    CUSTOMERS_DATA_REQUEST: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
    CUSTOMERS_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
    SHOP_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      await shopify.registerWebhooks({ session });

      // Bootstrap a Shop row so the storefront-facing api.* handlers
      // (eligibility/check, recommendations/*, events/*) can scope queries
      // to this shop. Idempotent — re-installs and token refreshes simply
      // update the existing row's accessToken/scope. Without this, the
      // first signed proxy request from the cart-block returns "404 Shop
      // not found" even though OAuth succeeded.
      if (!session.accessToken) return;

      const dbShop = await prisma.shop.upsert({
        where: { shopifyDomain: session.shop },
        update: {
          accessToken: session.accessToken,
          scope: session.scope ?? null,
        },
        create: {
          shopifyDomain: session.shop,
          accessToken: session.accessToken,
          scope: session.scope ?? null,
        },
      });

      // Register the carrier service if we don't already have an ID for
      // this shop. Idempotent: re-installs find the row and skip the call.
      // If a previous registration was deleted out-of-band on Shopify's
      // side, the next checkout would surface zero rates — operator can
      // null `carrierServiceId` in DB to retry.
      if (!dbShop.carrierServiceId) {
        const cs = await registerCarrierService(
          adminGraphqlFn(session.shop, session.accessToken),
          buildCallbackUrl(env.SHOPIFY_APP_URL),
        );
        if (cs) {
          await prisma.shop.update({
            where: { shopifyDomain: session.shop },
            data: { carrierServiceId: cs.id },
          });
          logger.info("Carrier service registered", {
            shop: session.shop,
            id: cs.id,
            callback: cs.callbackUrl,
          });
        } else {
          logger.warn("Carrier service registration failed; will retry on next install", {
            shop: session.shop,
          });
        }
      }
    },
  },
  future: {
    // Use OAuth token exchange instead of cookie-based redirect OAuth.
    // Required because modern browsers block third-party cookies, which
    // breaks the legacy embedded-app auth flow inside Shopify admin iframes.
    // Pairs with Shopify-managed installation in Partners.
    unstable_newEmbeddedAuthStrategy: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
