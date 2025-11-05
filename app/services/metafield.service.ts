/**
 * Metafield Service
 * Manage Shopify metafields for orders
 */

import type { GraphQLClient } from '@shopify/shopify-api';

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

const NAMESPACE = 'ordak_scheduling';

/**
 * Add scheduling metafields to an order
 */
export async function addOrderMetafields(
  graphql: GraphQLClient,
  orderId: string,
  metafields: SchedulingMetafields
): Promise<boolean> {
  try {
    const mutation = `
      mutation orderUpdate($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            metafields(first: 10, namespace: "${NAMESPACE}") {
              edges {
                node {
                  id
                  key
                  value
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        id: orderId,
        metafields: [
          {
            namespace: NAMESPACE,
            key: 'slot_id',
            value: metafields.slotId,
            type: 'single_line_text_field',
          },
          {
            namespace: NAMESPACE,
            key: 'slot_date',
            value: metafields.slotDate,
            type: 'date',
          },
          {
            namespace: NAMESPACE,
            key: 'slot_time_start',
            value: metafields.slotTimeStart,
            type: 'single_line_text_field',
          },
          {
            namespace: NAMESPACE,
            key: 'slot_time_end',
            value: metafields.slotTimeEnd,
            type: 'single_line_text_field',
          },
          {
            namespace: NAMESPACE,
            key: 'fulfillment_type',
            value: metafields.fulfillmentType,
            type: 'single_line_text_field',
          },
          {
            namespace: NAMESPACE,
            key: 'location_id',
            value: metafields.locationId,
            type: 'single_line_text_field',
          },
          {
            namespace: NAMESPACE,
            key: 'location_name',
            value: metafields.locationName,
            type: 'single_line_text_field',
          },
          {
            namespace: NAMESPACE,
            key: 'was_recommended',
            value: metafields.wasRecommended.toString(),
            type: 'boolean',
          },
        ],
      },
    };

    const response = await graphql(mutation, { variables });

    if (response.data?.orderUpdate?.userErrors?.length > 0) {
      console.error(
        'Metafield errors:',
        response.data.orderUpdate.userErrors
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to add metafields:', error);
    return false;
  }
}

/**
 * Add order tags
 */
export async function addOrderTags(
  graphql: GraphQLClient,
  orderId: string,
  tags: string[]
): Promise<boolean> {
  try {
    const mutation = `
      mutation tagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      id: orderId,
      tags,
    };

    const response = await graphql(mutation, { variables });

    if (response.data?.tagsAdd?.userErrors?.length > 0) {
      console.error('Tag errors:', response.data.tagsAdd.userErrors);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to add tags:', error);
    return false;
  }
}

/**
 * Get order metafields
 */
export async function getOrderMetafields(
  graphql: GraphQLClient,
  orderId: string
): Promise<Record<string, string> | null> {
  try {
    const query = `
      query getOrder($id: ID!) {
        order(id: $id) {
          id
          metafields(first: 20, namespace: "${NAMESPACE}") {
            edges {
              node {
                key
                value
              }
            }
          }
        }
      }
    `;

    const variables = { id: orderId };
    const response = await graphql(query, { variables });

    if (!response.data?.order) {
      return null;
    }

    const metafields: Record<string, string> = {};
    response.data.order.metafields.edges.forEach((edge: any) => {
      metafields[edge.node.key] = edge.node.value;
    });

    return metafields;
  } catch (error) {
    console.error('Failed to get metafields:', error);
    return null;
  }
}

/**
 * Update order note with scheduling details
 */
export async function addOrderNote(
  graphql: GraphQLClient,
  orderId: string,
  note: string
): Promise<boolean> {
  try {
    const mutation = `
      mutation orderUpdate($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            note
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        id: orderId,
        note,
      },
    };

    const response = await graphql(mutation, { variables });

    if (response.data?.orderUpdate?.userErrors?.length > 0) {
      console.error('Note errors:', response.data.orderUpdate.userErrors);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to add note:', error);
    return false;
  }
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

  return `
📅 ${type} Scheduled

Date: ${date}
Time: ${metafields.slotTimeStart} - ${metafields.slotTimeEnd}
Location: ${metafields.locationName}
${metafields.wasRecommended ? '⭐ Recommended slot selected' : ''}

Slot ID: ${metafields.slotId}
  `.trim();
}

/**
 * Generate tags for order
 */
export function generateOrderTags(metafields: SchedulingMetafields): string[] {
  const tags = [
    'ordak-scheduled',
    `ordak-${metafields.fulfillmentType}`,
  ];

  if (metafields.wasRecommended) {
    tags.push('ordak-recommended');
  }

  // Add date tag (YYYY-MM-DD)
  const dateTag = `ordak-date-${metafields.slotDate}`;
  tags.push(dateTag);

  return tags;
}
