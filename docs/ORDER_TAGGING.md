# Order Tagging & Metafields

Ordak automatically tags orders with scheduling information and adds metafields for easy filtering, automation, and fulfillment management.

## Overview

When a customer selects a delivery or pickup slot during checkout, Ordak:

1. **Creates an OrderLink** - Links the Shopify order to the selected slot in our database
2. **Adds Metafields** - Attaches scheduling data to the order as metafields
3. **Adds Tags** - Tags the order for easy filtering
4. **Adds Note** - Adds a human-readable note with scheduling details

## Metafields

All metafields are stored under the `ordak_scheduling` namespace.

### Available Metafields

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `slot_id` | single_line_text_field | Internal slot ID | `slot_abc123` |
| `slot_date` | date | Scheduled date | `2025-12-25` |
| `slot_time_start` | single_line_text_field | Start time | `09:00` |
| `slot_time_end` | single_line_text_field | End time | `11:00` |
| `fulfillment_type` | single_line_text_field | Type of fulfillment | `delivery` or `pickup` |
| `location_id` | single_line_text_field | Fulfillment location ID | `loc_xyz789` |
| `location_name` | single_line_text_field | Location name | `Sydney Warehouse` |
| `was_recommended` | boolean | If slot was recommended | `true` or `false` |

### Accessing Metafields

#### In Liquid Templates

```liquid
{% assign slot_date = order.metafields.ordak_scheduling.slot_date %}
{% assign slot_time_start = order.metafields.ordak_scheduling.slot_time_start %}
{% assign slot_time_end = order.metafields.ordak_scheduling.slot_time_end %}
{% assign fulfillment_type = order.metafields.ordak_scheduling.fulfillment_type %}
{% assign location_name = order.metafields.ordak_scheduling.location_name %}

<div class="order-scheduling">
  <h3>Your {{ fulfillment_type | capitalize }} is Scheduled</h3>
  <p>Date: {{ slot_date | date: "%B %d, %Y" }}</p>
  <p>Time: {{ slot_time_start }} - {{ slot_time_end }}</p>
  <p>Location: {{ location_name }}</p>
</div>
```

#### In GraphQL

```graphql
query GetOrder($id: ID!) {
  order(id: $id) {
    id
    name
    metafields(first: 10, namespace: "ordak_scheduling") {
      edges {
        node {
          key
          value
          type
        }
      }
    }
  }
}
```

#### Via REST API

```javascript
GET /admin/api/2024-01/orders/{order_id}/metafields.json?namespace=ordak_scheduling
```

## Order Tags

Orders are automatically tagged for easy filtering and automation.

### Tag Format

- `ordak-scheduled` - Order has scheduling
- `ordak-delivery` or `ordak-pickup` - Fulfillment type
- `ordak-date-YYYY-MM-DD` - Scheduled date (e.g., `ordak-date-2025-12-25`)
- `ordak-recommended` - Customer selected a recommended slot (optional)

### Using Tags

#### Filter Orders in Shopify Admin

1. Go to **Orders**
2. Click **Filter**
3. Select **Tagged with**
4. Enter: `ordak-delivery` or `ordak-pickup` or `ordak-date-2025-12-25`

#### In Liquid

```liquid
{% if order.tags contains 'ordak-scheduled' %}
  <div class="scheduled-order">
    {% if order.tags contains 'ordak-delivery' %}
      <p>🚚 Delivery Scheduled</p>
    {% elsif order.tags contains 'ordak-pickup' %}
      <p>📦 Pickup Scheduled</p>
    {% endif %}
  </div>
{% endif %}
```

#### In Shopify Flow

Create automations based on tags:

1. **Trigger:** Order created
2. **Condition:** Order has tag `ordak-delivery`
3. **Action:** Send email to warehouse team

## Order Notes

A human-readable note is added to each order with scheduling details.

### Note Format

```
📅 Delivery Scheduled

Date: Friday, December 25, 2025
Time: 09:00 - 11:00
Location: Sydney Warehouse
⭐ Recommended slot selected

Slot ID: slot_abc123
```

### Accessing Notes

```liquid
{{ order.note }}
```

## API Integration

### Tag an Order

When a customer selects a slot, call the tagging API:

**Endpoint:** `POST /api/orders/tag`

**Request:**
```json
{
  "orderId": "5678901234",
  "orderNumber": "#1234",
  "slotId": "slot_abc123",
  "customerId": "cust_xyz789",
  "customerEmail": "customer@example.com",
  "customerPhone": "+61 400 000 000",
  "deliveryAddress": "123 Main St, Sydney NSW 2000",
  "deliveryPostcode": "2000",
  "wasRecommended": true,
  "recommendationScore": 0.95
}
```

**Response:**
```json
{
  "success": true,
  "orderLink": {
    "id": "link_123",
    "shopifyOrderId": "5678901234",
    "slotId": "slot_abc123"
  }
}
```

### Get Order Scheduling Info

**Endpoint:** `GET /api/orders/tag?orderId=5678901234`

**Response:**
```json
{
  "orderId": "5678901234",
  "orderNumber": "#1234",
  "fulfillmentType": "delivery",
  "status": "scheduled",
  "slot": {
    "id": "slot_abc123",
    "date": "2025-12-25T00:00:00.000Z",
    "timeStart": "09:00",
    "timeEnd": "11:00",
    "location": {
      "name": "Sydney Warehouse",
      "address": "123 Warehouse Rd",
      "city": "Sydney"
    }
  },
  "wasRecommended": true,
  "createdAt": "2025-11-02T10:30:00.000Z"
}
```

### Update Order Schedule

**Endpoint:** `POST /api/orders/update-schedule`

**Request:**
```json
{
  "orderId": "5678901234",
  "slotId": "slot_new456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Schedule updated successfully"
}
```

## Webhook Integration

Ordak listens to Shopify webhooks to automatically process orders.

### Registered Webhooks

- `orders/create` - Adds metafields and tags when order is created

### Webhook Flow

1. Customer completes checkout with slot selection
2. Ordak tags the order via `POST /api/orders/tag`
3. Shopify creates the order
4. Shopify fires `orders/create` webhook
5. Ordak webhook handler adds metafields and tags
6. Order is fully tagged and ready for fulfillment

## Admin Dashboard

View all scheduled orders in the Ordak admin:

**Location:** Apps > Ordak > Scheduled Orders

**Features:**
- Filter by status (scheduled, updated, completed, canceled)
- Filter by fulfillment type (delivery, pickup)
- View scheduled date, time, and location
- See which orders used recommended slots
- Quick link to Shopify order admin

## Use Cases

### 1. Email Notifications

Send customers a reminder email the day before their scheduled delivery:

```liquid
{% if order.metafields.ordak_scheduling.slot_date %}
  <h2>Delivery Reminder</h2>
  <p>Your delivery is scheduled for:</p>
  <p><strong>{{ order.metafields.ordak_scheduling.slot_date | date: "%B %d, %Y" }}</strong></p>
  <p>Time: {{ order.metafields.ordak_scheduling.slot_time_start }} - {{ order.metafields.ordak_scheduling.slot_time_end }}</p>
{% endif %}
```

### 2. Fulfillment Automation

Use Shopify Flow to route orders to the correct warehouse:

**Trigger:** Order created
**Condition:** Order has tag `ordak-pickup`
**Action:** Update order location to the pickup location from metafield

### 3. Packing Slips

Include scheduling info on packing slips:

```liquid
<div class="scheduling-info">
  {% if order.metafields.ordak_scheduling.fulfillment_type == 'delivery' %}
    <h3>Delivery Instructions</h3>
    <p>Deliver on: {{ order.metafields.ordak_scheduling.slot_date | date: "%B %d, %Y" }}</p>
    <p>Time Window: {{ order.metafields.ordak_scheduling.slot_time_start }} - {{ order.metafields.ordak_scheduling.slot_time_end }}</p>
  {% elsif order.metafields.ordak_scheduling.fulfillment_type == 'pickup' %}
    <h3>Pickup Instructions</h3>
    <p>Ready for pickup on: {{ order.metafields.ordak_scheduling.slot_date | date: "%B %d, %Y" }}</p>
    <p>Pickup Window: {{ order.metafields.ordak_scheduling.slot_time_start }} - {{ order.metafields.ordak_scheduling.slot_time_end }}</p>
    <p>Location: {{ order.metafields.ordak_scheduling.location_name }}</p>
  {% endif %}
</div>
```

### 4. Order Status Page

Show scheduling info on the order status page:

```liquid
{% if order.metafields.ordak_scheduling.slot_date %}
  <div class="order-scheduling-status">
    {% if order.metafields.ordak_scheduling.fulfillment_type == 'delivery' %}
      <h3>🚚 Delivery Scheduled</h3>
    {% else %}
      <h3>📦 Pickup Scheduled</h3>
    {% endif %}

    <div class="schedule-details">
      <p><strong>Date:</strong> {{ order.metafields.ordak_scheduling.slot_date | date: "%A, %B %d, %Y" }}</p>
      <p><strong>Time:</strong> {{ order.metafields.ordak_scheduling.slot_time_start }} - {{ order.metafields.ordak_scheduling.slot_time_end }}</p>
      <p><strong>Location:</strong> {{ order.metafields.ordak_scheduling.location_name }}</p>
    </div>

    {% if order.metafields.ordak_scheduling.was_recommended == 'true' %}
      <p class="recommendation-badge">⭐ You selected a recommended slot for faster delivery</p>
    {% endif %}
  </div>
{% endif %}
```

### 5. Route Optimization

Export scheduled deliveries for route planning:

```javascript
// Fetch all orders for a specific date
const date = '2025-12-25';
const orders = await fetch(`/admin/api/2024-01/orders.json?tags=ordak-date-${date}`);

// Group by location for route optimization
const ordersByLocation = {};
orders.forEach(order => {
  const locationId = order.metafields.find(m =>
    m.namespace === 'ordak_scheduling' && m.key === 'location_id'
  )?.value;

  if (!ordersByLocation[locationId]) {
    ordersByLocation[locationId] = [];
  }
  ordersByLocation[locationId].push(order);
});
```

## Troubleshooting

### Metafields Not Appearing

1. Check if order was tagged: `GET /api/orders/tag?orderId=ORDER_ID`
2. Verify webhook received: Check webhook logs in Shopify admin
3. Check event logs in Ordak admin

### Tags Not Added

1. Ensure `orders/create` webhook is registered
2. Check webhook delivery in Shopify admin
3. Verify order exists in OrderLink table

### Missing Scheduling Info

1. Confirm slot was selected before checkout
2. Check if `POST /api/orders/tag` was called
3. Verify slot still exists and is active

## Database Schema

### OrderLink Table

Stores the relationship between Shopify orders and slots:

```prisma
model OrderLink {
  id                String   @id @default(cuid())
  shopifyOrderId    String   @unique
  shopifyOrderNumber String?
  slotId            String
  fulfillmentType   String   // 'delivery' or 'pickup'
  customerEmail     String?
  customerPhone     String?
  deliveryAddress   String?
  deliveryPostcode  String?
  wasRecommended    Boolean  @default(false)
  recommendationScore Float?
  status            String   @default("scheduled")
  notes             String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

## Best Practices

1. **Always tag orders immediately** after slot selection
2. **Use metafields for automation** instead of parsing order notes
3. **Filter by tags** for bulk operations (e.g., all deliveries for a date)
4. **Include scheduling info** in customer communications
5. **Update metafields** when rescheduling orders
6. **Log events** for audit trail and troubleshooting

## Support

For issues or questions about order tagging:
- Check webhook delivery logs in Shopify admin
- Review event logs in Ordak admin
- Verify metafield namespace and keys
- Contact support with order ID and error details
