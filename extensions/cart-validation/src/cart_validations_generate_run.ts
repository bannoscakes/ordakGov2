import type {
  CartValidationsGenerateRunInput,
  CartValidationsGenerateRunResult,
} from "../generated/api";

const NO_ERRORS: CartValidationsGenerateRunResult = { operations: [] };

const PROMPT_TO_PICK_IN_CART =
  "Please add this item to your cart and choose a delivery date and time slot before checking out.";

function nonEmpty(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

// Prefer line-level _delivery_method (matches Carrier Service + C.5 Function
// reads); fall back to cart-level which the cart-block writes first.
function readChoice(input: CartValidationsGenerateRunInput): "delivery" | "pickup" | null {
  for (const line of input.cart.lines) {
    const v = line.lineDeliveryMethod?.value;
    if (v === "delivery" || v === "pickup") return v;
  }
  const cartAttr = input.cart.cartDeliveryMethod?.value;
  if (cartAttr === "delivery" || cartAttr === "pickup") return cartAttr;
  return null;
}

function firstLineProperty(
  input: CartValidationsGenerateRunInput,
  field: "slotId" | "locationId" | "zoneId",
): string | null {
  for (const line of input.cart.lines) {
    const v = line[field]?.value;
    if (nonEmpty(v)) return v!;
  }
  return null;
}

function rejectWith(message: string): CartValidationsGenerateRunResult {
  return {
    operations: [
      { validationAdd: { errors: [{ message, target: "$.cart" }] } },
    ],
  };
}

export function cartValidationsGenerateRun(
  input: CartValidationsGenerateRunInput,
): CartValidationsGenerateRunResult {
  // Fail closed on any uncaught throw. Shopify Functions silently treat a
  // thrown error as "no validation operations" — i.e. checkout proceeds
  // unguarded. That breaks the whole point of this function. Catching here
  // ensures any future bug surfaces as a polite blocking error instead of a
  // silent gap in the gate.
  try {
    return run(input);
  } catch (err) {
    // console.error in a Shopify Function writes to the run log accessible
    // via Partners → App → Functions, so a future bug here leaves a trail
    // for diagnosis instead of silently blocking checkout with no signal.
    console.error("[ordak] cart-validation run threw:", err);
    return rejectWith(
      "Checkout temporarily unavailable. Please refresh your cart and try again.",
    );
  }
}

function run(input: CartValidationsGenerateRunInput): CartValidationsGenerateRunResult {
  const choice = readChoice(input);

  if (!choice) {
    return rejectWith(
      "Please choose Delivery or Pickup before checkout. Add this item to your cart and complete the scheduling step.",
    );
  }

  const slotId = firstLineProperty(input, "slotId");
  if (!slotId) {
    return rejectWith(PROMPT_TO_PICK_IN_CART);
  }

  if (choice === "delivery") {
    // Loose fallback: zone is the strict signal, location alone is acceptable.
    const zoneId = firstLineProperty(input, "zoneId");
    const locationId = firstLineProperty(input, "locationId");
    if (!zoneId && !locationId) {
      return rejectWith(
        "Please enter a delivery postcode in your cart and choose a delivery slot before checkout.",
      );
    }
  } else {
    const locationId = firstLineProperty(input, "locationId");
    if (!locationId) {
      return rejectWith(
        "Please choose a pickup location in your cart before checkout.",
      );
    }
  }

  return NO_ERRORS;
}
