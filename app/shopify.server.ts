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

const env = getEnv();

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
      if (!session.accessToken) {
        // Should be unreachable under unstable_newEmbeddedAuthStrategy +
        // token-exchange. Logged so a future SDK regression doesn't silently
        // skip the bootstrap — the symptom is "404 Shop not found" on every
        // storefront proxy request with no breadcrumb pointing here.
        logger.error("afterAuth: session has no accessToken; Shop bootstrap skipped", undefined, {
          shop: session.shop,
        });
        return;
      }

      await prisma.shop.upsert({
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
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
