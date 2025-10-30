# Storefront Slot Picker Widget - Installation Guide

This guide explains how to integrate the ordakGov2 slot picker widget into your Shopify store.

## Overview

The widget provides a customer-facing interface for selecting delivery/pickup slots with:
- ⭐ Recommended slots highlighted with badges
- 📅 Calendar date selector
- ⏰ Time slot grid with availability
- 📊 Real-time capacity information
- 🎯 Automatic event tracking and analytics

## Installation Methods

### Method 1: Theme App Extension (Recommended)

1. Install the ordakGov2 app from the Shopify App Store
2. In your Shopify admin, go to **Online Store → Themes**
3. Click **Customize** on your active theme
4. Add the "Delivery Slot Picker" app block to your product or cart page
5. Configure the settings in the theme editor

### Method 2: Manual Installation (Advanced)

If you need custom positioning or behavior, you can manually embed the widget:

#### Step 1: Add Widget Assets to Theme

Add these files to your theme's `assets` folder:

```liquid
<!-- In your theme.liquid or product template -->
{{ 'ordak-widget.css' | asset_url | stylesheet_tag }}
{{ 'ordak-widget.js' | asset_url | script_tag }}
```

Or link directly to the hosted files:

```html
<link rel="stylesheet" href="https://your-app-url.com/ordak-widget.css">
<script src="https://your-app-url.com/ordak-widget.js"></script>
```

#### Step 2: Add Widget Container

Add the widget container where you want it to appear (product page, cart page, etc.):

```html
<div id="ordak-slot-picker"></div>
```

#### Step 3: Initialize the Widget

Add initialization code:

```html
<script>
  // Set your app URL
  window.ORDAK_API_URL = 'https://your-app-url.com';

  // Wait for DOM to be ready
  document.addEventListener('DOMContentLoaded', function() {
    // Initialize the slot picker
    window.ordakPicker = new OrdakSlotPicker('ordak-slot-picker', {
      fulfillmentType: 'delivery', // or 'pickup'
      locationId: null, // Optional: filter by specific location
      customerId: '{{ customer.id }}', // Shopify Liquid variable
      customerEmail: '{{ customer.email }}', // Shopify Liquid variable
      deliveryAddress: {
        latitude: null, // Set if available
        longitude: null, // Set if available
        postcode: '{{ customer.default_address.zip }}',
      },
      onSelect: function(slot) {
        console.log('Slot selected:', slot);

        // Save to cart attributes
        fetch('/cart/update.js', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            attributes: {
              'Delivery Date': slot.date,
              'Delivery Time': slot.timeStart + ' - ' + slot.timeEnd,
              'Delivery Slot ID': slot.slotId,
            }
          })
        });
      }
    });
  });
</script>
```

## Configuration Options

### Constructor Options

```javascript
new OrdakSlotPicker(containerId, {
  // Required
  fulfillmentType: 'delivery', // or 'pickup'

  // Optional
  locationId: 'loc_123',        // Filter slots by location
  customerId: 'customer_xyz',   // For personalization
  customerEmail: 'customer@example.com', // For personalization
  deliveryAddress: {
    latitude: -33.8688,
    longitude: 151.2093,
    postcode: '2000'
  },
  showAlternatives: true,       // Show alternative suggestions

  // Callback when slot is selected
  onSelect: function(slot) {
    // Handle slot selection
    // slot contains: slotId, date, timeStart, timeEnd,
    //                recommendationScore, recommended, reason
  }
});
```

## Integration Examples

### Example 1: Product Page

```liquid
{% comment %} In your product-template.liquid {% endcomment %}

<div class="product-delivery-options">
  <h3>Select Delivery Time</h3>
  <div id="ordak-slot-picker"></div>
</div>

<script>
  document.addEventListener('DOMContentLoaded', function() {
    window.ordakPicker = new OrdakSlotPicker('ordak-slot-picker', {
      fulfillmentType: 'delivery',
      customerId: '{{ customer.id }}',
      customerEmail: '{{ customer.email }}',
      onSelect: function(slot) {
        // Add to cart attributes
        document.querySelector('[name="properties[Delivery Date]"]').value = slot.date;
        document.querySelector('[name="properties[Delivery Time]"]').value =
          slot.timeStart + ' - ' + slot.timeEnd;
      }
    });
  });
</script>
```

### Example 2: Cart Page

```liquid
{% comment %} In your cart-template.liquid {% endcomment %}

<div class="cart-delivery-selection">
  <h2>Choose Your Delivery Time</h2>
  <div id="ordak-slot-picker"></div>
  <button id="update-delivery-btn" style="display:none;">
    Update Delivery Time
  </button>
</div>

<script>
  document.addEventListener('DOMContentLoaded', function() {
    window.ordakPicker = new OrdakSlotPicker('ordak-slot-picker', {
      fulfillmentType: 'delivery',
      customerId: '{{ customer.id }}',
      customerEmail: '{{ customer.email }}',
      deliveryAddress: {
        postcode: '{{ customer.default_address.zip }}'
      },
      onSelect: function(slot) {
        // Show update button
        document.getElementById('update-delivery-btn').style.display = 'block';

        // Update cart on button click
        document.getElementById('update-delivery-btn').onclick = function() {
          fetch('/cart/update.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              attributes: {
                'Delivery Date': slot.date,
                'Delivery Time': slot.timeStart + ' - ' + slot.timeEnd,
                'Delivery Slot ID': slot.slotId,
                'Slot Recommended': slot.recommended ? 'Yes' : 'No'
              }
            })
          }).then(() => {
            alert('Delivery time updated!');
          });
        };
      }
    });
  });
</script>
```

### Example 3: Pickup Location Selector

```liquid
<div class="pickup-options">
  <h3>Select Pickup Location & Time</h3>

  <!-- Location selector -->
  <select id="location-selector">
    <option value="">Choose a pickup location...</option>
    {% comment %} Populate with your locations {% endcomment %}
  </select>

  <!-- Slot picker -->
  <div id="ordak-slot-picker" style="display:none;"></div>
</div>

<script>
  let picker;

  document.getElementById('location-selector').addEventListener('change', function() {
    const locationId = this.value;

    if (locationId) {
      document.getElementById('ordak-slot-picker').style.display = 'block';

      // Initialize or update picker
      picker = new OrdakSlotPicker('ordak-slot-picker', {
        fulfillmentType: 'pickup',
        locationId: locationId,
        customerId: '{{ customer.id }}',
        onSelect: function(slot) {
          console.log('Pickup slot selected:', slot);
        }
      });
    }
  });
</script>
```

## Styling Customization

You can override the default styles by adding custom CSS:

```css
/* Example: Custom brand colors */
.ordak-slot.recommended {
  border-color: #your-brand-color;
  background: #your-light-brand-color;
}

.ordak-badge {
  background: #your-brand-color;
  color: #your-text-color;
}

.ordak-date-btn.active {
  background: #your-brand-color;
  border-color: #your-brand-color;
}
```

## API Requirements

The widget requires your ordakGov2 app to be installed and accessible. Ensure:

1. The app is installed on your Shopify store
2. Recommendations are enabled in app settings
3. At least one location is configured
4. Slots are available for the selected date range

## Troubleshooting

### Widget doesn't load

- Check browser console for JavaScript errors
- Verify `ORDAK_API_URL` is set correctly
- Ensure widget files are loaded (check Network tab)

### No slots showing

- Verify recommendations are enabled in app admin
- Check that locations and slots are configured
- Review date range (widget looks 14 days ahead by default)

### Recommendations not appearing

- Ensure recommendation weights are configured
- Check that customer context is being passed
- Verify analytics in app admin shows views/selections

## Advanced Features

### Getting Selected Slot Programmatically

```javascript
const selectedSlot = window.ordakPicker.getSelectedSlot();

if (selectedSlot) {
  console.log('Current selection:', selectedSlot);
  // Use selected slot data
}
```

### Reloading Slots

```javascript
// Reload slots after changing options
window.ordakPicker.options.locationId = 'new_location_id';
window.ordakPicker.init();
```

## Support

For issues or questions:
1. Check the app admin for configuration errors
2. Review browser console for error messages
3. Contact support with error details

## Performance Notes

- Widget bundle size: ~8KB gzipped
- Lazy loads slots on initialization
- Caches API responses for 60 seconds
- Tracks views/selections for analytics
- Optimized for mobile and desktop

## Security

- All API requests use CORS-protected endpoints
- Customer data is encrypted in transit
- Session IDs are temporary and anonymous
- No PII is stored without consent
