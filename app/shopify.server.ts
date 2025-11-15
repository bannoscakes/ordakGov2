import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { restResources } from "@shopify/shopify-api/rest/admin/2024-01";
import prisma from "./db.server";
import { getEnv } from "./utils/env.server";

// Validate environment variables at startup
const env = getEnv();

const shopify = shopifyApp({
  apiKey: env.SHOPIFY_API_KEY,
  apiSecretKey: env.SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.January24,
  scopes: env.SCOPES.split(","),
  appUrl: env.SHOPIFY_APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  restResources,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: "http",
      callbackUrl: "/webhooks",
    },
    CUSTOMERS_DATA_REQUEST: {
      deliveryMethod: "http",
      callbackUrl: "/webhooks",
    },
    CUSTOMERS_REDACT: {
      deliveryMethod: "http",
      callbackUrl: "/webhooks",
    },
    SHOP_REDACT: {
      deliveryMethod: "http",
      callbackUrl: "/webhooks",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      shopify.registerWebhooks({ session });
    },
  },
  future: {
    v3_webhookAdminContext: true,
    v3_authenticatePublic: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January24;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
