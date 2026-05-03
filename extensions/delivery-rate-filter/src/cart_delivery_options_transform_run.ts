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
// LOCAL = local delivery, RETAIL, NONE) is treated as "delivery" for the
// purposes of this filter.
const PICKUP_METHODS = new Set(["PICK_UP", "PICKUP_POINT"]);

export function cartDeliveryOptionsTransformRun(
  input: CartDeliveryOptionsTransformRunInput,
): CartDeliveryOptionsTransformRunResult {
  const choice = readCustomerChoice(input);
  if (!choice) return NO_CHANGES;

  const operations = [] as CartDeliveryOptionsTransformRunResult["operations"];
  for (const group of input.cart.deliveryGroups) {
    for (const option of group.deliveryOptions) {
      const isPickup = PICKUP_METHODS.has(option.deliveryMethodType);
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
