/**
 * Test setup file
 * Runs before all tests to configure the test environment
 */

import { beforeAll, afterAll, vi } from "vitest";

// Setup environment variables for testing
beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/ordakgov2_test";
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || "test_api_key";
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "test_api_secret";
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test_session_secret";
});

// Cleanup after all tests
afterAll(() => {
  // Add any global cleanup here
});

// Mock Shopify API by default
vi.mock("@shopify/shopify-app-remix/server", () => ({
  shopifyApp: vi.fn(() => ({
    authenticate: {
      admin: vi.fn(),
      public: vi.fn(),
      webhook: vi.fn(),
    },
  })),
  ApiVersion: {
    January24: "2024-01",
  },
  AppDistribution: {
    AppStore: "app_store",
  },
}));
