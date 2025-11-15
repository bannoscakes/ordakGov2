/**
 * Ordak Postcode Eligibility Checker Widget
 * A lightweight widget for customers to check if their postcode is eligible for delivery/pickup
 *
 * Usage:
 * <div id="ordak-postcode-checker"></div>
 * <script src="https://your-app-domain.com/postcode-checker.js"></script>
 * <script>
 *   new OrdakPostcodeChecker('ordak-postcode-checker', {
 *     shopDomain: 'yourstore.myshopify.com',
 *     apiUrl: 'https://your-app-domain.com/api/eligibility/check'
 *   });
 * </script>
 */

(function (window) {
  'use strict';

  // Default configuration
  const DEFAULT_CONFIG = {
    apiUrl: '/api/eligibility/check',
    shopDomain: window.Shopify?.shop || '',
    showFulfillmentType: true,
    theme: 'light',
  };

  class OrdakPostcodeChecker {
    constructor(containerId, options = {}) {
      this.container = document.getElementById(containerId);
      if (!this.container) {
        console.error(`Container with ID "${containerId}" not found`);
        return;
      }

      this.options = { ...DEFAULT_CONFIG, ...options };
      this.state = {
        loading: false,
        result: null,
        error: null,
      };

      this.init();
    }

    init() {
      this.render();
      this.attachEventListeners();
    }

    render() {
      this.container.innerHTML = `
        <div class="ordak-checker">
          <div class="ordak-checker-header">
            <h3 class="ordak-checker-title">Check Delivery & Pickup Availability</h3>
            <p class="ordak-checker-subtitle">Enter your postcode to see if we deliver to your area</p>
          </div>

          <form class="ordak-checker-form" id="ordak-checker-form">
            <div class="ordak-checker-input-group">
              <input
                type="text"
                id="ordak-postcode-input"
                class="ordak-checker-input"
                placeholder="Enter your postcode"
                required
              />
              ${
                this.options.showFulfillmentType
                  ? `
                <div class="ordak-checker-options">
                  <label class="ordak-checker-option">
                    <input type="radio" name="fulfillmentType" value="" checked />
                    <span>Both</span>
                  </label>
                  <label class="ordak-checker-option">
                    <input type="radio" name="fulfillmentType" value="delivery" />
                    <span>Delivery</span>
                  </label>
                  <label class="ordak-checker-option">
                    <input type="radio" name="fulfillmentType" value="pickup" />
                    <span>Pickup</span>
                  </label>
                </div>
              `
                  : ''
              }
            </div>

            <button
              type="submit"
              class="ordak-checker-button"
              id="ordak-checker-submit"
            >
              Check Availability
            </button>
          </form>

          <div class="ordak-checker-result" id="ordak-checker-result" style="display: none;"></div>
        </div>
      `;
    }

    attachEventListeners() {
      const form = document.getElementById('ordak-checker-form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.checkEligibility();
      });
    }

    async checkEligibility() {
      const input = document.getElementById('ordak-postcode-input');
      const postcode = input.value.trim();

      if (!postcode) {
        this.showError('Please enter a postcode');
        return;
      }

      this.setLoading(true);
      this.hideResult();

      try {
        const fulfillmentTypeInput = document.querySelector(
          'input[name="fulfillmentType"]:checked'
        );
        const fulfillmentType = fulfillmentTypeInput
          ? fulfillmentTypeInput.value
          : '';

        const response = await fetch(this.options.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            postcode,
            fulfillmentType: fulfillmentType || undefined,
            shopDomain: this.options.shopDomain,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to check eligibility');
        }

        const data = await response.json();
        this.showResult(data);
      } catch (error) {
        console.error('Eligibility check error:', error);
        this.showError('Unable to check eligibility. Please try again.');
      } finally {
        this.setLoading(false);
      }
    }

    setLoading(loading) {
      this.state.loading = loading;
      const button = document.getElementById('ordak-checker-submit');

      if (loading) {
        button.disabled = true;
        button.textContent = 'Checking...';
        button.classList.add('ordak-checker-button-loading');
      } else {
        button.disabled = false;
        button.textContent = 'Check Availability';
        button.classList.remove('ordak-checker-button-loading');
      }
    }

    // Helper function to safely escape text content
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Helper function to create element with text content safely
    createElement(tag, className, textContent) {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (textContent) el.textContent = textContent;
      return el;
    }

    showResult(data) {
      const resultContainer = document.getElementById('ordak-checker-result');
      this.state.result = data;

      // Clear previous content
      resultContainer.innerHTML = '';

      if (data.eligible) {
        const successDiv = this.createElement('div', 'ordak-checker-success');

        // Icon
        const icon = this.createElement('div', 'ordak-checker-icon ordak-checker-icon-success', '✓');
        successDiv.appendChild(icon);

        // Title
        const title = this.createElement('h4', 'ordak-checker-result-title', 'Great news! We deliver to your area');
        successDiv.appendChild(title);

        // Message (safely escaped)
        const message = this.createElement('p', 'ordak-checker-result-message', data.message || '');
        successDiv.appendChild(message);

        // Services
        if (data.services) {
          const servicesText = data.services.delivery && data.services.pickup
            ? 'Available: Delivery & Pickup'
            : data.services.delivery
            ? 'Available: Delivery'
            : data.services.pickup
            ? 'Available: Pickup'
            : '';

          if (servicesText) {
            const services = document.createElement('p');
            services.className = 'ordak-checker-services';
            services.innerHTML = servicesText.replace('Delivery', '<strong>Delivery</strong>').replace('Pickup', '<strong>Pickup</strong>');
            successDiv.appendChild(services);
          }
        }

        // Locations
        if (data.locations && data.locations.length > 0) {
          const locationsDiv = this.createElement('div', 'ordak-checker-locations');
          const locationsTitle = this.createElement('h5', 'ordak-checker-locations-title', 'Available Locations:');
          locationsDiv.appendChild(locationsTitle);

          const locationsList = document.createElement('ul');
          locationsList.className = 'ordak-checker-locations-list';

          data.locations.forEach((loc) => {
            const li = document.createElement('li');
            li.className = 'ordak-checker-location';

            // Location name (safely escaped)
            const name = document.createElement('strong');
            name.textContent = loc.name;
            li.appendChild(name);

            // City (safely escaped)
            if (loc.city) {
              const city = document.createElement('span');
              city.className = 'ordak-checker-location-city';
              city.textContent = loc.city;
              li.appendChild(city);
            }

            // Services badges
            const servicesDiv = document.createElement('div');
            servicesDiv.className = 'ordak-checker-location-services';

            if (loc.supportsDelivery) {
              const deliveryBadge = this.createElement('span', 'ordak-checker-service-badge', 'Delivery');
              servicesDiv.appendChild(deliveryBadge);
            }

            if (loc.supportsPickup) {
              const pickupBadge = this.createElement('span', 'ordak-checker-service-badge', 'Pickup');
              servicesDiv.appendChild(pickupBadge);
            }

            li.appendChild(servicesDiv);
            locationsList.appendChild(li);
          });

          locationsDiv.appendChild(locationsList);
          successDiv.appendChild(locationsDiv);
        }

        resultContainer.appendChild(successDiv);
      } else {
        const errorDiv = this.createElement('div', 'ordak-checker-error');

        // Icon
        const icon = this.createElement('div', 'ordak-checker-icon ordak-checker-icon-error', '✕');
        errorDiv.appendChild(icon);

        // Title
        const title = this.createElement('h4', 'ordak-checker-result-title', "Sorry, we don't deliver to your area yet");
        errorDiv.appendChild(title);

        // Message (safely escaped)
        const message = this.createElement('p', 'ordak-checker-result-message', data.message || 'No service available in your postcode');
        errorDiv.appendChild(message);

        resultContainer.appendChild(errorDiv);
      }

      resultContainer.style.display = 'block';
    }

    showError(message) {
      const resultContainer = document.getElementById('ordak-checker-result');
      this.state.error = message;

      resultContainer.innerHTML = `
        <div class="ordak-checker-error">
          <div class="ordak-checker-icon ordak-checker-icon-error">⚠</div>
          <p class="ordak-checker-result-message">${message}</p>
        </div>
      `;

      resultContainer.style.display = 'block';
    }

    hideResult() {
      const resultContainer = document.getElementById('ordak-checker-result');
      resultContainer.style.display = 'none';
      this.state.result = null;
      this.state.error = null;
    }
  }

  // Expose to global scope
  window.OrdakPostcodeChecker = OrdakPostcodeChecker;
})(window);
