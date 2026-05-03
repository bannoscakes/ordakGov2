import type {
  CartDeliveryOptionsTransformRunInput,
  CartDeliveryOptionsTransformRunResult,
} from "../generated/api";

const NO_CHANGES: CartDeliveryOptionsTransformRunResult = { operations: [] };

// The cart-block stamps `_delivery_method` (value `"delivery"` or `"pickup"`)
// onto every line item. We pull the value off the first line — the cart-block
// writes the same value to every line.
function readCustomerChoice(
  input: CartDeliveryOptionsTransformRunInput,
): "delivery" | "pickup" | null {
  for (const line of input.cart.lines) {
    const v = line.attribute?.value;
    if (v === "delivery" || v === "pickup") return v;
  }
  return null;
}

// Shopify's native pickup methods. PICK_UP is in-store Local Pickup;
// PICKUP_POINT is third-party pickup networks. Everything else (SHIPPING,
// LOCAL, RETAIL, NONE) is delivery — UNLESS the rate's handle/title is
// pickup-coded (used when the merchant doesn't have Carrier-Calculated
// Shipping and wires a manual "Pickup at <store>" flat rate, which
// Shopify types as SHIPPING). The handle pattern lets us treat those
// flat rates as pickup for filtering purposes.
const PICKUP_METHODS = new Set(["PICK_UP", "PICKUP_POINT"]);
const PICKUP_PATTERN = /pickup|pick[-_ ]?up|in[-_ ]?store|click[-_ ]?(and|&)[-_ ]?collect|collect/i;

function isPickupOption(option: {
  handle: string;
  title?: string | null;
  code?: string | null;
  deliveryMethodType: string;
}): boolean {
  if (PICKUP_METHODS.has(option.deliveryMethodType)) return true;
  // Manual flat rates often have auto-generated handles (like
  // "shopify-Pickup%20at%20Annandale-0.00"); the customer-facing name lives
  // in `title`. Match on whichever surfaces the merchant's intent.
  return [option.handle, option.title, option.code]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .some((s) => PICKUP_PATTERN.test(s));
}

export function cartDeliveryOptionsTransformRun(
  input: CartDeliveryOptionsTransformRunInput,
): CartDeliveryOptionsTransformRunResult {
  const choice = readCustomerChoice(input);
  if (!choice) return NO_CHANGES;

  const operations = [] as CartDeliveryOptionsTransformRunResult["operations"];
  for (const group of input.cart.deliveryGroups) {
    for (const option of group.deliveryOptions) {
      const isPickup = isPickupOption(option);
      const shouldHide =
        (choice === "pickup" && !isPickup) ||
        (choice === "delivery" && isPickup);
      if (shouldHide) {
        operations.push({
          deliveryOptionHide: { deliveryOptionHandle: option.handle },
        });
      }
    }
  }
  return operations.length ? { operations } : NO_CHANGES;
}
