# Ordak Fulfillment Toggle Widget - Installation Guide

A lightweight toggle component that allows customers to switch between delivery and pickup options. Perfect for integrating with the slot picker or using standalone.

## Features

- **Simple Toggle UI**: Clean, accessible button toggle
- **Preference Saving**: Remembers customer choice in session
- **Event System**: Broadcasts changes for other widgets to listen
- **Multiple Themes**: Default, minimal, pills, and custom
- **Responsive Design**: Mobile-optimized layouts
- **Lightweight**: ~2KB JS + 2KB CSS (gzipped)
- **No Dependencies**: Pure vanilla JavaScript
- **Accessibility**: WCAG AA compliant

## Installation

### Step 1: Add the Widget Files

Upload the widget files to your Shopify theme:

1. Go to **Online Store > Themes > Actions > Edit code**
2. Create new assets:
   - `Assets/fulfillment-toggle.js` - Copy content from `public/fulfillment-toggle.js`
   - `Assets/fulfillment-toggle.css` - Copy content from `public/fulfillment-toggle.css`

### Step 2: Add to Your Theme

#### Basic Usage

```liquid
{{ 'fulfillment-toggle.css' | asset_url | stylesheet_tag }}

<div id="ordak-fulfillment-toggle"></div>

{{ 'fulfillment-toggle.js' | asset_url | script_tag }}
<script>
  new OrdakFulfillmentToggle('ordak-fulfillment-toggle', {
    defaultType: 'delivery',
    onChange: function(type) {
      console.log('Selected fulfillment type:', type);
    }
  });
</script>
```

#### Auto-Initialize with Data Attributes

```liquid
{{ 'fulfillment-toggle.css' | asset_url | stylesheet_tag }}

<div
  id="ordak-fulfillment-toggle"
  data-ordak-toggle
  data-default-type="delivery"
  data-theme="minimal"
></div>

{{ 'fulfillment-toggle.js' | asset_url | script_tag }}
```

The widget will automatically initialize when the page loads.

## Configuration Options

```javascript
new OrdakFulfillmentToggle('container-id', {
  // Default selection (default: 'delivery')
  defaultType: 'delivery', // or 'pickup'

  // Show text labels (default: true)
  showLabels: true,

  // Show emoji icons (default: true)
  showIcons: true,

  // Save preference to sessionStorage (default: true)
  savePreference: true,

  // Visual theme (default: 'default')
  // Options: 'default', 'minimal', 'pills'
  theme: 'default',

  // Callback when selection changes
  onChange: function(type) {
    console.log('User selected:', type);
  }
});
```

## Themes

### Default Theme
Standard button style with clear active state.

```javascript
new OrdakFulfillmentToggle('toggle', { theme: 'default' });
```

### Minimal Theme
Clean segmented control style, great for modern interfaces.

```javascript
new OrdakFulfillmentToggle('toggle', { theme: 'minimal' });
```

### Pills Theme
Rounded pill buttons, perfect for compact spaces.

```javascript
new OrdakFulfillmentToggle('toggle', { theme: 'pills' });
```

## Integration Examples

### Example 1: Product Page

Show delivery/pickup options on product pages:

```liquid
<div class="product-fulfillment">
  <h3>Choose your fulfillment method</h3>
  {{ 'fulfillment-toggle.css' | asset_url | stylesheet_tag }}
  <div id="ordak-fulfillment-toggle"></div>
  {{ 'fulfillment-toggle.js' | asset_url | script_tag }}
  <script>
    new OrdakFulfillmentToggle('ordak-fulfillment-toggle', {
      defaultType: 'delivery',
      theme: 'minimal'
    });
  </script>
</div>
```

### Example 2: Cart Page

Let customers choose fulfillment before checkout:

```liquid
<div class="cart-fulfillment-selector">
  {{ 'fulfillment-toggle.css' | asset_url | stylesheet_tag }}
  <div
    id="cart-toggle"
    data-ordak-toggle
    data-theme="pills"
    data-default-type="delivery"
  ></div>
  {{ 'fulfillment-toggle.js' | asset_url | script_tag }}
</div>
```

### Example 3: Integration with Slot Picker

Connect the toggle to the slot picker widget:

```liquid
<!-- Fulfillment Toggle -->
{{ 'fulfillment-toggle.css' | asset_url | stylesheet_tag }}
<div id="ordak-fulfillment-toggle"></div>

<!-- Slot Picker -->
{{ 'ordak-widget.css' | asset_url | stylesheet_tag }}
<div id="ordak-slot-picker"></div>

<!-- Scripts -->
{{ 'fulfillment-toggle.js' | asset_url | script_tag }}
{{ 'ordak-widget.js' | asset_url | script_tag }}
<script>
  // Initialize toggle
  const toggle = new OrdakFulfillmentToggle('ordak-fulfillment-toggle', {
    defaultType: 'delivery',
    onChange: function(type) {
      // Update slot picker when toggle changes
      if (window.ordakPicker) {
        window.ordakPicker.updateFulfillmentType(type);
      }
    }
  });

  // Initialize slot picker
  window.ordakPicker = new OrdakSlotPicker('ordak-slot-picker', {
    fulfillmentType: toggle.getSelectedType(),
    customerId: '{{ customer.id }}',
    onSelect: function(slot) {
      console.log('Slot selected:', slot);
    }
  });
</script>
```

### Example 4: Custom Event Listener

Listen to toggle changes anywhere in your code:

```javascript
document.addEventListener('ordak:fulfillment-change', function(e) {
  const type = e.detail.type;
  console.log('Fulfillment type changed to:', type);

  // Update shipping rates, slot availability, etc.
  updateShippingOptions(type);
});
```

## Public API Methods

```javascript
const toggle = new OrdakFulfillmentToggle('toggle-id', options);

// Get current selection
const type = toggle.getSelectedType(); // Returns 'delivery' or 'pickup'

// Programmatically change selection
toggle.setType('pickup');

// Reset to default
toggle.reset();
```

## Styling Customization

Override default styles with custom CSS:

```css
/* Change active color */
.ordak-toggle-option.active {
  background: #ff6b6b;
  border-color: #ff6b6b;
}

/* Make full width */
.ordak-toggle-options {
  display: flex;
  width: 100%;
}

.ordak-toggle-option {
  flex: 1;
}

/* Remove icons */
.ordak-toggle-icon {
  display: none;
}

/* Custom font */
.ordak-toggle {
  font-family: 'Your Custom Font', sans-serif;
}
```

## Advanced Customization

### Custom Icons

Replace default emojis with custom icons:

```javascript
// After initialization, replace icons
document.querySelectorAll('.ordak-toggle-icon').forEach((icon, index) => {
  icon.innerHTML = index === 0
    ? '<svg>...delivery icon...</svg>'
    : '<svg>...pickup icon...</svg>';
});
```

### Conditional Display

Show/hide based on product availability:

```liquid
{% if product.tags contains 'delivery-only' %}
  <div id="ordak-fulfillment-toggle"></div>
  <script>
    new OrdakFulfillmentToggle('ordak-fulfillment-toggle', {
      defaultType: 'delivery'
    });
  </script>
{% elsif product.tags contains 'pickup-only' %}
  <div id="ordak-fulfillment-toggle"></div>
  <script>
    new OrdakFulfillmentToggle('ordak-fulfillment-toggle', {
      defaultType: 'pickup'
    });
  </script>
{% else %}
  <!-- Show both options -->
  <div id="ordak-fulfillment-toggle"></div>
  <script>
    new OrdakFulfillmentToggle('ordak-fulfillment-toggle', {
      defaultType: 'delivery'
    });
  </script>
{% endif %}
```

## Event Reference

### ordak:fulfillment-change

Dispatched when the toggle selection changes.

```javascript
document.addEventListener('ordak:fulfillment-change', function(e) {
  console.log('New type:', e.detail.type); // 'delivery' or 'pickup'
});
```

**Event Detail:**
```javascript
{
  type: 'delivery' // or 'pickup'
}
```

## Session Storage

When `savePreference: true`, the widget saves the customer's choice to `sessionStorage` under the key `ordak_fulfillment_type`.

You can access this value anywhere:

```javascript
const savedType = sessionStorage.getItem('ordak_fulfillment_type');
console.log('Saved preference:', savedType); // 'delivery' or 'pickup'
```

## Troubleshooting

### Toggle Not Showing

1. Verify container ID: `<div id="ordak-fulfillment-toggle"></div>`
2. Check browser console for JavaScript errors
3. Ensure CSS and JS files are loaded

### Selection Not Saving

1. Check if `savePreference` is set to `true`
2. Verify browser allows sessionStorage
3. Check for private/incognito mode restrictions

### Events Not Firing

1. Ensure `onChange` callback is a function
2. Check for JavaScript errors in console
3. Verify event listener is attached before toggle initialization

### Styling Conflicts

1. Check for theme CSS conflicts
2. Use browser inspector to identify conflicting rules
3. Add `!important` to override if needed
4. Ensure custom CSS loads after widget CSS

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile browsers (iOS Safari 14+, Chrome Mobile)

## Performance

- **Initial Load:** ~4KB total (2KB JS + 2KB CSS, gzipped)
- **Render Time:** < 10ms on modern devices
- **Memory:** Minimal footprint (~10KB)

## Accessibility

- Keyboard navigation (Tab, Enter, Space)
- ARIA labels for screen readers
- Focus indicators
- Semantic button elements
- WCAG AA color contrast

## Security

- No external dependencies
- No sensitive data stored
- sessionStorage only (cleared on tab close)
- Safe for production use

## Migration from Other Solutions

If you're using a different toggle solution, migration is straightforward:

```javascript
// Old solution
$('#toggle').on('change', function() {
  const value = $(this).val();
});

// Ordak solution
new OrdakFulfillmentToggle('toggle', {
  onChange: function(type) {
    // Same logic here
  }
});
```

## Support

For issues or questions:
- Check troubleshooting section
- Review browser console for errors
- Test in different browsers
- Contact support with error details
