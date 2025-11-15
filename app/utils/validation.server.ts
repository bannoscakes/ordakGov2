import { z } from "zod";
import { json } from "@remix-run/node";

/**
 * Validation schemas for API endpoints
 */

// Postcode validation (supports UK, US, and generic formats)
export const postcodeSchema = z.string().min(2).max(10).trim();

// Email validation
export const emailSchema = z.string().email().optional();

// Phone validation
export const phoneSchema = z.string().min(10).max(20).optional();

// Shopify domain validation
export const shopDomainSchema = z.string().regex(/^[a-zA-Z0-9-]+\.myshopify\.com$/);

// Fulfillment type
export const fulfillmentTypeSchema = z.enum(["delivery", "pickup"]);

// Coordinates
export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

/**
 * Eligibility check request validation
 */
export const eligibilityCheckSchema = z.object({
  postcode: postcodeSchema,
  fulfillmentType: fulfillmentTypeSchema.optional(),
  shopDomain: shopDomainSchema,
});

/**
 * Recommendation requests validation
 */
export const recommendationLocationSchema = z.object({
  postcode: postcodeSchema,
  fulfillmentType: fulfillmentTypeSchema,
  shopDomain: shopDomainSchema,
  customerEmail: emailSchema,
  deliveryAddress: z.string().optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
});

export const recommendationSlotSchema = z.object({
  locationId: z.string().cuid(),
  startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  fulfillmentType: fulfillmentTypeSchema,
  shopDomain: shopDomainSchema,
  customerEmail: emailSchema,
});

/**
 * Order tagging validation
 */
export const orderTagSchema = z.object({
  orderId: z.string().min(1),
  slotId: z.string().cuid(),
  fulfillmentType: fulfillmentTypeSchema,
  shopDomain: shopDomainSchema,
  customerEmail: emailSchema,
  customerPhone: phoneSchema,
  deliveryAddress: z.string().optional(),
  deliveryPostcode: postcodeSchema.optional(),
  wasRecommended: z.boolean().optional(),
  recommendationScore: z.number().min(0).max(1).optional(),
});

/**
 * Reschedule validation
 */
export const rescheduleSchema = z.object({
  shop: shopDomainSchema,
  orderId: z.string().min(1),
  newSlotId: z.string().cuid(),
});

/**
 * Event logging validation
 */
export const eventLogSchema = z.object({
  eventType: z.enum([
    "recommendation.viewed",
    "recommendation.selected",
    "order.scheduled",
    "order.schedule_updated",
    "order.schedule_canceled",
  ]),
  sessionId: z.string().min(1),
  customerId: z.string().optional(),
  customerEmail: emailSchema,
  shopDomain: shopDomainSchema,
  payload: z.record(z.any()),
});

/**
 * Helper function to validate request body and return errors
 */
export async function validateRequest<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ data: T; error: null } | { data: null; error: Response }> {
  try {
    const body = await request.json();
    const data = schema.parse(body);
    return { data, error: null };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        data: null,
        error: json(
          {
            error: "Validation error",
            details: error.errors.map((e) => ({
              path: e.path.join("."),
              message: e.message,
            })),
          },
          { status: 400 }
        ),
      };
    }
    return {
      data: null,
      error: json({ error: "Invalid request body" }, { status: 400 }),
    };
  }
}

/**
 * Helper function to validate FormData
 */
export function validateFormData<T>(
  formData: FormData,
  schema: z.ZodSchema<T>
): { data: T; error: null } | { data: null; error: Response } {
  try {
    const obj: Record<string, any> = {};
    for (const [key, value] of formData.entries()) {
      obj[key] = value;
    }
    const data = schema.parse(obj);
    return { data, error: null };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        data: null,
        error: json(
          {
            error: "Validation error",
            details: error.errors.map((e) => ({
              path: e.path.join("."),
              message: e.message,
            })),
          },
          { status: 400 }
        ),
      };
    }
    return {
      data: null,
      error: json({ error: "Invalid form data" }, { status: 400 }),
    };
  }
}
