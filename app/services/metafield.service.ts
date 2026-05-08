/**
 * Metafield Service
 *
 * Wraps Shopify Admin GraphQL mutations that write order metafields, tags,
 * and notes. Each helper returns a discriminated result so the caller can
 * distinguish between "Shopify rejected the input" (userErrors), "the
 * GraphQL request itself failed" (top-level errors / thrown), and success
 * — and surface the actual reason in logs and webhook responses.
 *
 * Hard rule: callers MUST inspect the returned `ok` flag and decide whether
 * to retry. Returning a boolean from this layer collapsed too much error
 * context and led to a real production bug where the webhook returned 200
 * while metafields silently failed (split-brain between our DB and the
 * merchant's Shopify admin).
 */

import { logger } from "../utils/logger.server";

export interface SchedulingMetafields {
  slotId: string;
  slotDate: string;
  slotTimeStart: string;
  slotTimeEnd: string;
  fulfillmentType: 'delivery' | 'pickup';
  locationId: string;
  locationName: string;
  wasRecommended: boolean;
}

export type MutationResult =
  | { ok: true }
  | { ok: false; reason: "graphqlErrors" | "userErrors" | "threw" | "noData"; detail: string };

const NAMESPACE = 'ordak_scheduling';

interface GraphqlClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (query: string, options?: { variables?: Record<string, any> }): Promise<{ json: () => Promise<unknown> }>;
}

interface GraphqlResponseBody {
  data?: Record<string, unknown> | null;
  errors?: Array<{ message: string }>;
}

interface ResultBlock {
  userErrors?: Array<{ field?: string[] | null; message: string }>;
}

async function runMutation(
  graphql: GraphqlClient,
  query: string,
  variables: Record<string, unknown>,
  resultKey: string,
  context: Record<string, unknown>,
): Promise<MutationResult> {
  let body: GraphqlResponseBody;
  try {
    const response = await graphql(query, { variables });
    body = (await response.json()) as GraphqlResponseBody;
  } catch (err) {
    logger.error(`${resultKey}: request threw`, err, context);
    return { ok: false, reason: "threw", detail: err instanceof Error ? err.message : String(err) };
  }

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const detail = body.errors.map((e) => e.message).join("; ");
    logger.error(`${resultKey}: top-level GraphQL errors`, undefined, { ...context, errors: body.errors });
    return { ok: false, reason: "graphqlErrors", detail };
  }

  const result = body.data?.[resultKey] as ResultBlock | undefined;
  if (!result) {
    logger.error(`${resultKey}: no data block in response`, undefined, { ...context, body });
    return { ok: false, reason: "noData", detail: "Mutation returned no data" };
  }

  if (result.userErrors && result.userErrors.length > 0) {
    const detail = result.userErrors
      .map((e) => `${e.field?.join(".") ?? "?"}: ${e.message}`)
      .join("; ");
    logger.error(`${resultKey}: userErrors`, undefined, { ...context, userErrors: result.userErrors });
    return { ok: false, reason: "userErrors", detail };
  }

  return { ok: true };
}

export async function addOrderMetafields(
  graphql: GraphqlClient,
  orderId: string,
  metafields: SchedulingMetafields,
): Promise<MutationResult> {
  const mutation = `#graphql
    mutation orderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) {
        order {
          id
          metafields(first: 10, namespace: "${NAMESPACE}") {
            edges { node { id key value } }
          }
        }
        userErrors { field message }
      }
    }`;

  const variables = {
    input: {
      id: orderId,
      metafields: [
        { namespace: NAMESPACE, key: 'slot_id', value: metafields.slotId, type: 'single_line_text_field' },
        { namespace: NAMESPACE, key: 'slot_date', value: metafields.slotDate, type: 'date' },
        { namespace: NAMESPACE, key: 'slot_time_start', value: metafields.slotTimeStart, type: 'single_line_text_field' },
        { namespace: NAMESPACE, key: 'slot_time_end', value: metafields.slotTimeEnd, type: 'single_line_text_field' },
        { namespace: NAMESPACE, key: 'fulfillment_type', value: metafields.fulfillmentType, type: 'single_line_text_field' },
        { namespace: NAMESPACE, key: 'location_id', value: metafields.locationId, type: 'single_line_text_field' },
        { namespace: NAMESPACE, key: 'location_name', value: metafields.locationName, type: 'single_line_text_field' },
        { namespace: NAMESPACE, key: 'was_recommended', value: metafields.wasRecommended.toString(), type: 'boolean' },
      ],
    },
  };

  return runMutation(graphql, mutation, variables, "orderUpdate", { orderId, mutation: "orderUpdate-metafields" });
}

export async function addOrderTags(
  graphql: GraphqlClient,
  orderId: string,
  tags: string[],
): Promise<MutationResult> {
  const mutation = `#graphql
    mutation tagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }`;
  return runMutation(
    graphql,
    mutation,
    { id: orderId, tags },
    "tagsAdd",
    { orderId, mutation: "tagsAdd", tags },
  );
}

/**
 * Get order metafields. Returns null on any failure (not used in critical
 * path — diagnostic helper only).
 */
export async function getOrderMetafields(
  graphql: GraphqlClient,
  orderId: string,
): Promise<Record<string, string> | null> {
  const query = `#graphql
    query getOrder($id: ID!) {
      order(id: $id) {
        id
        metafields(first: 20, namespace: "${NAMESPACE}") {
          edges { node { key value } }
        }
      }
    }`;
  try {
    const response = await graphql(query, { variables: { id: orderId } });
    const body = (await response.json()) as {
      data?: { order?: { metafields?: { edges?: Array<{ node?: { key?: string; value?: string } }> } } };
      errors?: Array<{ message: string }>;
    };
    if (Array.isArray(body.errors) && body.errors.length) {
      logger.error("getOrderMetafields: top-level GraphQL errors", undefined, { orderId, errors: body.errors });
      return null;
    }
    const edges = body.data?.order?.metafields?.edges ?? [];
    const out: Record<string, string> = {};
    for (const edge of edges) {
      const key = edge?.node?.key;
      const value = edge?.node?.value;
      if (key && typeof value === "string") out[key] = value;
    }
    return out;
  } catch (err) {
    logger.error("getOrderMetafields: request threw", err, { orderId });
    return null;
  }
}

/**
 * Update order note. WARNING: This OVERWRITES any existing note (customer's
 * cart-stage note, merchant's ops notes, etc.). The orders/create webhook
 * intentionally does NOT call this — note belongs to customer + merchant,
 * not us. Kept exported in case a future admin UI needs it for explicit
 * merchant-initiated edits.
 */
export async function addOrderNote(
  graphql: GraphqlClient,
  orderId: string,
  note: string,
): Promise<MutationResult> {
  const mutation = `#graphql
    mutation orderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id note }
        userErrors { field message }
      }
    }`;
  return runMutation(
    graphql,
    mutation,
    { input: { id: orderId, note } },
    "orderUpdate",
    { orderId, mutation: "orderUpdate-note" },
  );
}

/**
 * Generate human-readable note for order
 */
export function generateOrderNote(metafields: SchedulingMetafields): string {
  const date = new Date(metafields.slotDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const type =
    metafields.fulfillmentType === 'delivery' ? 'Delivery' : 'Pickup';

  // Merchant-facing summary that lives in the order's Notes field. Keep
  // it human-readable — internal IDs (slot id, location id) live in the
  // ordak_scheduling metafields panel for diagnostics, not here.
  const lines = [
    `${type} scheduled`,
    "",
    `Date: ${date}`,
    `Time: ${metafields.slotTimeStart} - ${metafields.slotTimeEnd}`,
    `Location: ${metafields.locationName}`,
  ];
  if (metafields.wasRecommended) {
    lines.push("Recommended slot selected");
  }
  return lines.join("\n");
}

/**
 * Generate tags for order
 */
export function generateOrderTags(metafields: SchedulingMetafields): string[] {
  const tags = [
    'ordak-scheduled',
    `ordak-${metafields.fulfillmentType}`,
  ];
  if (metafields.wasRecommended) tags.push('ordak-recommended');
  tags.push(`ordak-date-${metafields.slotDate}`);
  return tags;
}
