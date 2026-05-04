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

// Resolve the customer's delivery_method choice: prefer line-level (the seam
// the Carrier Service and Delivery Customization function both read), fall
// back to cart-level which the cart-block writes first.
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
    // Delivery requires either a resolved zone (cart-block writes once
    // postcode matches) or at minimum a location id (loose fallback).
    const zoneId = firstLineProperty(input, "zoneId");
    const locationId = firstLineProperty(input, "locationId");
    if (!zoneId && !locationId) {
      return rejectWith(
        "Please enter a delivery postcode in your cart and choose a delivery slot before checkout.",
      );
    }
  } else {
    // Pickup needs an explicit pickup location.
    const locationId = firstLineProperty(input, "locationId");
    if (!locationId) {
      return rejectWith(
        "Please choose a pickup location in your cart before checkout.",
      );
    }
  }

  return NO_ERRORS;
}
