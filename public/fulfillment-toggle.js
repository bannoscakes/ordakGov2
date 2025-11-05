/**
 * Ordak Fulfillment Type Toggle Widget
 * A simple toggle to switch between delivery and pickup
 *
 * Usage:
 * <div id="ordak-fulfillment-toggle"></div>
 * <script src="https://your-app-domain.com/fulfillment-toggle.js"></script>
 * <script>
 *   new OrdakFulfillmentToggle('ordak-fulfillment-toggle', {
 *     defaultType: 'delivery',
 *     onChange: function(type) { console.log('Selected:', type); }
 *   });
 * </script>
 */

(function (window) {
  'use strict';

  // Default configuration
  const DEFAULT_CONFIG = {
    defaultType: 'delivery', // 'delivery' or 'pickup'
    showLabels: true,
    showIcons: true,
    savePreference: true, // Save to sessionStorage
    theme: 'default', // 'default', 'minimal', 'pills'
    onChange: null, // Callback function
  };

  const STORAGE_KEY = 'ordak_fulfillment_type';

  class OrdakFulfillmentToggle {
    constructor(containerId, options = {}) {
      this.container = document.getElementById(containerId);
      if (!this.container) {
        console.error(`Container with ID "${containerId}" not found`);
        return;
      }

      this.options = { ...DEFAULT_CONFIG, ...options };

      // Get saved preference or use default
      this.selectedType = this.getSavedPreference() || this.options.defaultType;

      this.init();
    }

    init() {
      this.render();
      this.attachEventListeners();

      // Emit initial value
      if (this.options.onChange) {
        this.options.onChange(this.selectedType);
      }
    }

    getSavedPreference() {
      if (!this.options.savePreference) return null;

      try {
        return sessionStorage.getItem(STORAGE_KEY);
      } catch (e) {
        return null;
      }
    }

    savePreference(type) {
      if (!this.options.savePreference) return;

      try {
        sessionStorage.setItem(STORAGE_KEY, type);
      } catch (e) {
        console.warn('Failed to save fulfillment preference');
      }
    }

    render() {
      const { showLabels, showIcons, theme } = this.options;

      this.container.innerHTML = `
        <div class="ordak-toggle ordak-toggle-${theme}">
          ${
            showLabels
              ? '<label class="ordak-toggle-label">Select fulfillment method:</label>'
              : ''
          }
          <div class="ordak-toggle-options">
            <button
              class="ordak-toggle-option ${this.selectedType === 'delivery' ? 'active' : ''}"
              data-type="delivery"
            >
              ${showIcons ? '<span class="ordak-toggle-icon">🚚</span>' : ''}
              <span class="ordak-toggle-text">Delivery</span>
            </button>
            <button
              class="ordak-toggle-option ${this.selectedType === 'pickup' ? 'active' : ''}"
              data-type="pickup"
            >
              ${showIcons ? '<span class="ordak-toggle-icon">📦</span>' : ''}
              <span class="ordak-toggle-text">Pickup</span>
            </button>
          </div>
        </div>
      `;
    }

    attachEventListeners() {
      const buttons = this.container.querySelectorAll('.ordak-toggle-option');

      buttons.forEach((button) => {
        button.addEventListener('click', (e) => {
          e.preventDefault();
          const type = button.getAttribute('data-type');
          this.selectType(type);
        });
      });
    }

    selectType(type) {
      if (type !== 'delivery' && type !== 'pickup') {
        console.error('Invalid fulfillment type:', type);
        return;
      }

      // Update state
      this.selectedType = type;

      // Save preference
      this.savePreference(type);

      // Update UI
      const buttons = this.container.querySelectorAll('.ordak-toggle-option');
      buttons.forEach((button) => {
        const buttonType = button.getAttribute('data-type');
        if (buttonType === type) {
          button.classList.add('active');
        } else {
          button.classList.remove('active');
        }
      });

      // Emit change event
      if (this.options.onChange) {
        this.options.onChange(type);
      }

      // Dispatch custom event for other widgets to listen to
      const event = new CustomEvent('ordak:fulfillment-change', {
        detail: { type },
        bubbles: true,
      });
      this.container.dispatchEvent(event);
    }

    // Public API
    getSelectedType() {
      return this.selectedType;
    }

    setType(type) {
      this.selectType(type);
    }

    reset() {
      this.selectType(this.options.defaultType);
    }
  }

  // Expose to global scope
  window.OrdakFulfillmentToggle = OrdakFulfillmentToggle;

  // Auto-initialize if data-ordak-toggle attribute exists
  document.addEventListener('DOMContentLoaded', function() {
    const autoElements = document.querySelectorAll('[data-ordak-toggle]');
    autoElements.forEach((element) => {
      const options = {};

      if (element.dataset.defaultType) {
        options.defaultType = element.dataset.defaultType;
      }
      if (element.dataset.showLabels === 'false') {
        options.showLabels = false;
      }
      if (element.dataset.showIcons === 'false') {
        options.showIcons = false;
      }
      if (element.dataset.theme) {
        options.theme = element.dataset.theme;
      }

      new OrdakFulfillmentToggle(element.id, options);
    });
  });
})(window);
