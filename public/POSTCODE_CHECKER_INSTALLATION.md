# Ordak Postcode Eligibility Checker - Installation Guide

The Postcode Eligibility Checker allows customers to quickly check if their postcode is eligible for delivery and/or pickup services.

## Features

- **Zone Matching**: Checks customer postcode against configured zones
- **Service Discovery**: Shows which services (delivery/pickup) are available
- **Location Display**: Lists all available locations serving that postcode
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Lightweight**: ~6KB JS + 3KB CSS (gzipped)
- **Theme Support**: Light/dark mode with customizable colors
- **No Dependencies**: Pure vanilla JavaScript

## Installation

### Step 1: Add the Widget Files

Upload the widget files to your Shopify theme:

1. Go to **Online Store > Themes > Actions > Edit code**
2. Create new assets:
   - `Assets/postcode-checker.js` - Copy content from `public/postcode-checker.js`
   - `Assets/postcode-checker.css` - Copy content from `public/postcode-checker.css`

### Step 2: Add to Your Theme

#### Option A: Add to a Page Template

Edit a page template (e.g., `Templates/page.contact.liquid`):

```liquid
{{ 'postcode-checker.css' | asset_url | stylesheet_tag }}

<div id="ordak-postcode-checker"></div>

{{ 'postcode-checker.js' | asset_url | script_tag }}
<script>
  document.addEventListener('DOMContentLoaded', function() {
    new OrdakPostcodeChecker('ordak-postcode-checker', {
      shopDomain: '{{ shop.permanent_domain }}',
      apiUrl: 'https://your-app-domain.com/api/eligibility/check'
    });
  });
</script>
```

#### Option B: Add to Theme Sections

Create a new section `Sections/postcode-checker.liquid`:

```liquid
{{ 'postcode-checker.css' | asset_url | stylesheet_tag }}

<div class="page-width">
  <div id="ordak-postcode-checker"></div>
</div>

{{ 'postcode-checker.js' | asset_url | script_tag }}
<script>
  document.addEventListener('DOMContentLoaded', function() {
    new OrdakPostcodeChecker('ordak-postcode-checker', {
      shopDomain: '{{ shop.permanent_domain }}',
      apiUrl: '{{ section.settings.api_url }}'
    });
  });
</script>

{% schema %}
{
  "name": "Postcode Checker",
  "settings": [
    {
      "type": "text",
      "id": "api_url",
      "label": "API URL",
      "default": "https://your-app-domain.com/api/eligibility/check"
    }
  ],
  "presets": [
    {
      "name": "Postcode Checker"
    }
  ]
}
{% endschema %}
```

Then add the section to any page via the theme customizer.

#### Option C: Add to Product Pages

Edit `Sections/product-template.liquid` or `Sections/main-product.liquid`:

```liquid
<div class="product-postcode-check">
  {{ 'postcode-checker.css' | asset_url | stylesheet_tag }}
  <div id="ordak-postcode-checker"></div>
  {{ 'postcode-checker.js' | asset_url | script_tag }}
  <script>
    new OrdakPostcodeChecker('ordak-postcode-checker', {
      shopDomain: '{{ shop.permanent_domain }}',
      apiUrl: 'https://your-app-domain.com/api/eligibility/check'
    });
  </script>
</div>
```

## Configuration Options

```javascript
new OrdakPostcodeChecker('container-id', {
  // Required: Your Shopify domain
  shopDomain: 'yourstore.myshopify.com',

  // Required: API endpoint URL
  apiUrl: 'https://your-app-domain.com/api/eligibility/check',

  // Optional: Show fulfillment type selector (default: true)
  showFulfillmentType: true,

  // Optional: Theme (default: 'light', options: 'light', 'dark', 'auto')
  theme: 'light'
});
```

## API Endpoint

The widget calls the following API endpoint:

**Endpoint:** `POST /api/eligibility/check`

**Request Body:**
```json
{
  "postcode": "2000",
  "fulfillmentType": "delivery",  // Optional: "delivery", "pickup", or omit for both
  "shopDomain": "yourstore.myshopify.com"
}
```

**Response:**
```json
{
  "eligible": true,
  "locations": [
    {
      "id": "loc_123",
      "name": "Sydney Warehouse",
      "address": "123 Main St",
      "city": "Sydney",
      "supportsDelivery": true,
      "supportsPickup": true,
      "distance": null
    }
  ],
  "services": {
    "delivery": true,
    "pickup": true
  },
  "message": "Service available from 1 location"
}
```

## Styling Customization

You can override the default styles by adding custom CSS after the widget stylesheet:

```css
/* Change primary color */
.ordak-checker-button {
  background: #ff6b6b;
}

.ordak-checker-button:hover {
  background: #ff5252;
}

/* Customize success message */
.ordak-checker-success {
  background: #e8f5e9;
  border-color: #4caf50;
}

/* Adjust width */
.ordak-checker {
  max-width: 600px;
}

/* Custom font */
.ordak-checker {
  font-family: 'Your Custom Font', sans-serif;
}
```

## Advanced Usage

### Programmatic Check

You can check eligibility programmatically without rendering the UI:

```javascript
async function checkPostcode(postcode) {
  const response = await fetch('https://your-app-domain.com/api/eligibility/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postcode: postcode,
      shopDomain: 'yourstore.myshopify.com'
    })
  });

  const data = await response.json();
  return data;
}

// Usage
const result = await checkPostcode('2000');
if (result.eligible) {
  console.log('Eligible for delivery and/or pickup');
} else {
  console.log('Not eligible');
}
```

### Custom Event Handling

You can listen to widget events:

```javascript
const checker = new OrdakPostcodeChecker('ordak-postcode-checker', {
  shopDomain: '{{ shop.permanent_domain }}',
  apiUrl: 'https://your-app-domain.com/api/eligibility/check',
  onResult: function(result) {
    // Called when eligibility check completes
    console.log('Eligibility result:', result);

    if (result.eligible) {
      // Show success message, enable checkout, etc.
    } else {
      // Show alternative options
    }
  }
});
```

## Examples

### Example 1: Homepage Hero Section

```liquid
<div class="hero-section">
  <h1>Fast Delivery & Pickup</h1>
  <p>Check if we deliver to your area</p>

  {{ 'postcode-checker.css' | asset_url | stylesheet_tag }}
  <div id="ordak-postcode-checker"></div>
  {{ 'postcode-checker.js' | asset_url | script_tag }}
  <script>
    new OrdakPostcodeChecker('ordak-postcode-checker', {
      shopDomain: '{{ shop.permanent_domain }}',
      apiUrl: 'https://your-app-domain.com/api/eligibility/check'
    });
  </script>
</div>
```

### Example 2: Cart Page

```liquid
<div class="cart-postcode-check">
  <h3>Delivery Available?</h3>
  {{ 'postcode-checker.css' | asset_url | stylesheet_tag }}
  <div id="ordak-postcode-checker"></div>
  {{ 'postcode-checker.js' | asset_url | script_tag }}
  <script>
    new OrdakPostcodeChecker('ordak-postcode-checker', {
      shopDomain: '{{ shop.permanent_domain }}',
      apiUrl: 'https://your-app-domain.com/api/eligibility/check',
      showFulfillmentType: false  // Hide selector if only showing delivery
    });
  </script>
</div>
```

### Example 3: Footer Widget

```liquid
<div class="footer-checker">
  <h4>Delivery Coverage</h4>
  {{ 'postcode-checker.css' | asset_url | stylesheet_tag }}
  <div id="ordak-postcode-checker"></div>
  {{ 'postcode-checker.js' | asset_url | script_tag }}
  <script>
    new OrdakPostcodeChecker('ordak-postcode-checker', {
      shopDomain: '{{ shop.permanent_domain }}',
      apiUrl: 'https://your-app-domain.com/api/eligibility/check'
    });
  </script>
</div>
```

## Troubleshooting

### Widget Not Showing

1. Verify the container ID matches: `<div id="ordak-postcode-checker"></div>`
2. Check browser console for JavaScript errors
3. Ensure both CSS and JS files are properly loaded

### API Errors

1. Check the API URL is correct and accessible
2. Verify the shop domain is correctly set
3. Check browser network tab for failed requests
4. Ensure CORS is properly configured on your app

### Postcode Not Found

1. Verify zones are configured in admin
2. Check zone types (list, range, radius) match postcode format
3. Ensure zones are marked as active
4. Verify locations linked to zones are active

### Styling Issues

1. Check for CSS conflicts with theme styles
2. Use browser inspector to identify conflicting rules
3. Add `!important` to override theme styles if needed
4. Ensure the CSS file loads before custom overrides

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile browsers (iOS Safari 14+, Chrome Mobile)

## Performance

- **Initial Load:** ~9KB total (6KB JS + 3KB CSS, gzipped)
- **API Call:** Cached for 5 minutes per postcode
- **Render Time:** < 50ms on modern devices

## Accessibility

- ARIA labels for screen readers
- Keyboard navigation support
- Focus states on all interactive elements
- Semantic HTML structure
- Color contrast meets WCAG AA standards

## Security

- All API requests use HTTPS
- Input sanitization on postcode
- No sensitive data stored in browser
- CORS headers properly configured

## Support

For issues or questions:
- Check the troubleshooting section above
- Review browser console for errors
- Contact support with error details and screenshots
