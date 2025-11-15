/**
 * Environment variable validation
 * Validates all required environment variables at startup
 */

import { logger } from "./logger.server";

interface EnvironmentConfig {
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SHOPIFY_APP_URL: string;
  DATABASE_URL: string;
  SCOPES: string;
  NODE_ENV: string;
}

/**
 * Validate that all required environment variables are set
 * Throws an error if any required variables are missing
 */
export function validateEnvironment(): EnvironmentConfig {
  const requiredVars = [
    "SHOPIFY_API_KEY",
    "SHOPIFY_API_SECRET",
    "SHOPIFY_APP_URL",
    "DATABASE_URL",
    "SCOPES",
  ];

  const missing: string[] = [];
  const invalid: string[] = [];

  // Check for missing variables
  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (!value || value.trim() === "") {
      missing.push(varName);
    }
  }

  // If any are missing, throw error
  if (missing.length > 0) {
    const error = `Missing required environment variables: ${missing.join(", ")}`;
    logger.error("Environment validation failed", new Error(error));
    throw new Error(error);
  }

  // Validate format of specific variables
  const shopifyAppUrl = process.env.SHOPIFY_APP_URL!;
  if (!shopifyAppUrl.startsWith("http://") && !shopifyAppUrl.startsWith("https://")) {
    invalid.push("SHOPIFY_APP_URL must start with http:// or https://");
  }

  const databaseUrl = process.env.DATABASE_URL!;
  if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
    invalid.push("DATABASE_URL must be a valid PostgreSQL connection string");
  }

  // Check scopes format
  const scopes = process.env.SCOPES!;
  if (!scopes.includes(",")) {
    logger.warn("SCOPES environment variable should be comma-separated", { scopes });
  }

  if (invalid.length > 0) {
    const error = `Invalid environment variables:\n${invalid.join("\n")}`;
    logger.error("Environment validation failed", new Error(error));
    throw new Error(error);
  }

  // Log successful validation
  logger.info("Environment variables validated successfully", {
    nodeEnv: process.env.NODE_ENV || "development",
    appUrl: shopifyAppUrl,
    scopes: scopes.split(",").length,
  });

  return {
    SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY!,
    SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET!,
    SHOPIFY_APP_URL: shopifyAppUrl,
    DATABASE_URL: databaseUrl,
    SCOPES: scopes,
    NODE_ENV: process.env.NODE_ENV || "development",
  };
}

/**
 * Get validated environment configuration
 * Caches the result after first validation
 */
let cachedEnv: EnvironmentConfig | null = null;

export function getEnv(): EnvironmentConfig {
  if (!cachedEnv) {
    cachedEnv = validateEnvironment();
  }
  return cachedEnv;
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return !isProduction();
}
