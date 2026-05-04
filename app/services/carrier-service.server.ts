/**
 * Carrier Service
 *
 * Registers our app as a Shopify "carrier service" — Shopify will POST to a
 * callback URL during checkout to fetch shipping rates. Our callback reads
 * the destination address + line item properties (which the cart-block
 * mirrors from cart attributes) and returns the appropriate rates.
 *
 * Architectural note: Shopify's Carrier Service rate-request body does NOT
 * include cart `note_attributes`. Only origin / destination / items /
 * currency. To bridge cart-block selections (delivery vs pickup, slot id,
 * etc.) into the carrier service callback, the cart-block writes the same
 * info as `_`-prefixed line item properties on every line, which DO appear
 * in `request.rate.items[*].properties`. That's why this module's contract
 * is "read line item properties," not "read cart attributes."
 */

import { logger } from "../utils/logger.server";

export const CARRIER_SERVICE_NAME = "Ordak Go";

export interface CarrierServiceRecord {
  id: string;
  name: string;
  callbackUrl: string;
  active: boolean;
}

export type RegisterCarrierServiceResult =
  | { ok: true; record: CarrierServiceRecord }
  | { ok: false; error: string };

/**
 * Build the absolute callback URL Shopify will POST to. Single source of
 * truth — keep this in sync with the Remix route at
 * app/routes/api.carrier-service.rates.tsx.
 */
export function buildCallbackUrl(appUrl: string): string {
  return new URL("/api/carrier-service/rates", appUrl).toString();
}

/**
 * Register the carrier service with Shopify. Idempotent in spirit — if the
 * shop already has one registered (we'd see it via `carrierServices` query),
 * the caller should pass the existing ID through `unregisterCarrierService`
 * first. We don't list-then-create here because afterAuth callers know
 * whether they have a stored ID.
 */
export async function registerCarrierService(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graphql: any,
  callbackUrl: string,
): Promise<RegisterCarrierServiceResult> {
  try {
    const response = await graphql(
      `#graphql
      mutation CarrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
        carrierServiceCreate(input: $input) {
          carrierService {
            id
            name
            callbackUrl
            active
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: {
            name: CARRIER_SERVICE_NAME,
            callbackUrl,
            supportsServiceDiscovery: true,
            active: true,
          },
        },
      },
    );

    const json = await response.json();

    // Top-level GraphQL errors (e.g., schema drift, bad input type) live at
    // `json.errors`, not under `data.*.userErrors`. Surface these distinctly
    // so a future API-version bump that breaks the input shape doesn't
    // present as a generic "no carrier service" return.
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      logger.error("carrierServiceCreate top-level GraphQL errors", undefined, {
        errors: json.errors,
      });
      const msg = (json.errors[0]?.message as string | undefined) ?? "GraphQL error";
      return { ok: false, error: msg };
    }

    const result = json.data?.carrierServiceCreate;

    if (result?.userErrors?.length) {
      logger.error("carrierServiceCreate userErrors", undefined, {
        errors: result.userErrors,
      });
      const msg =
        (result.userErrors[0]?.message as string | undefined) ?? "Carrier service creation rejected";
      return { ok: false, error: msg };
    }

    if (!result?.carrierService) {
      logger.error("carrierServiceCreate returned no carrierService", undefined, {
        response: json,
      });
      return { ok: false, error: "Shopify returned no carrierService" };
    }

    return { ok: true, record: result.carrierService as CarrierServiceRecord };
  } catch (err) {
    logger.error("carrierServiceCreate threw", err);
    return { ok: false, error: err instanceof Error ? err.message : "carrierServiceCreate threw" };
  }
}

/**
 * List existing carrier services on the shop. Used by the install route
 * to detect a same-name registration left over from a previous install
 * (or a previous tunnel URL) and adopt its ID instead of failing on
 * "name already taken."
 */
export async function listCarrierServices(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graphql: any,
): Promise<CarrierServiceRecord[]> {
  try {
    const response = await graphql(
      `#graphql
      query OrdakGoListCarrierServices {
        carrierServices(first: 50) {
          nodes { id name callbackUrl active }
        }
      }`,
    );
    const json = await response.json();
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      logger.error("listCarrierServices top-level GraphQL errors", undefined, {
        errors: json.errors,
      });
      return [];
    }
    const nodes = (json.data?.carrierServices?.nodes ?? []) as CarrierServiceRecord[];
    return nodes;
  } catch (err) {
    logger.error("listCarrierServices threw", err);
    return [];
  }
}

/**
 * Update an existing carrier service's callbackUrl / active flag. Used
 * when the install route adopts a same-name registration whose callback
 * still points at a stale tunnel URL.
 */
export async function updateCarrierService(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graphql: any,
  carrierServiceId: string,
  callbackUrl: string,
): Promise<CarrierServiceRecord | null> {
  try {
    const response = await graphql(
      `#graphql
      mutation CarrierServiceUpdate($input: DeliveryCarrierServiceUpdateInput!) {
        carrierServiceUpdate(input: $input) {
          carrierService {
            id
            name
            callbackUrl
            active
          }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            id: carrierServiceId,
            callbackUrl,
            supportsServiceDiscovery: true,
            active: true,
          },
        },
      },
    );
    const json = await response.json();
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      logger.error("carrierServiceUpdate top-level GraphQL errors", undefined, {
        errors: json.errors,
      });
      return null;
    }
    const result = json.data?.carrierServiceUpdate;
    if (result?.userErrors?.length) {
      logger.error("carrierServiceUpdate userErrors", undefined, {
        errors: result.userErrors,
      });
      return null;
    }
    if (!result?.carrierService) return null;
    return result.carrierService as CarrierServiceRecord;
  } catch (err) {
    logger.error("carrierServiceUpdate threw", err);
    return null;
  }
}

/**
 * Delete the carrier service. Called on APP_UNINSTALLED so the dev-store
 * isn't left with an orphan registration pointing at a dead callback.
 * Returns true on success, false on Shopify-reported error.
 */
export async function unregisterCarrierService(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graphql: any,
  carrierServiceId: string,
): Promise<boolean> {
  try {
    const response = await graphql(
      `#graphql
      mutation CarrierServiceDelete($id: ID!) {
        carrierServiceDelete(id: $id) {
          deletedId
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: { id: carrierServiceId },
      },
    );

    const json = await response.json();

    if (Array.isArray(json.errors) && json.errors.length > 0) {
      logger.error("carrierServiceDelete top-level GraphQL errors", undefined, {
        errors: json.errors,
      });
      return false;
    }

    const result = json.data?.carrierServiceDelete;

    if (result?.userErrors?.length) {
      // Note: "carrier service not found" userErrors are benign on uninstall
      // (Shopify already deleted it). Caller should pattern-match if it
      // wants to downgrade those to info — see app/routes/webhooks.tsx.
      logger.error("carrierServiceDelete userErrors", undefined, {
        errors: result.userErrors,
      });
      return false;
    }

    return true;
  } catch (err) {
    logger.error("carrierServiceDelete threw", err);
    return false;
  }
}
