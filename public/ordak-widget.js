/**
 * Storefront Slot Picker Widget Script
 * Embeddable JavaScript for displaying delivery/pickup slots with recommendations
 */

(function () {
  'use strict';

  const WIDGET_API_BASE = window.ORDAK_API_URL || 'https://your-app-url.com';
  const SHOP_DOMAIN = window.Shopify?.shop || '';

  class OrdakSlotPicker {
    constructor(containerId, options = {}) {
      this.container = document.getElementById(containerId);
      if (!this.container) {
        console.error('OrdakSlotPicker: Container not found');
        return;
      }

      this.options = {
        fulfillmentType: options.fulfillmentType || 'delivery',
        locationId: options.locationId || null,
        customerId: options.customerId || null,
        customerEmail: options.customerEmail || null,
        deliveryAddress: options.deliveryAddress || null,
        onSelect: options.onSelect || (() => {}),
        showAlternatives: options.showAlternatives !== false,
        ...options,
      };

      this.sessionId = this.generateSessionId();
      this.selectedSlot = null;
      this.slots = [];

      this.init();
    }

    generateSessionId() {
      return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Helper function to safely escape HTML
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

    async init() {
      this.render();
      await this.loadSlots();
    }

    render() {
      this.container.innerHTML = `
        <div class="ordak-slot-picker">
          <div class="ordak-header">
            <h3>Select Your ${this.options.fulfillmentType === 'delivery' ? 'Delivery' : 'Pickup'} Time</h3>
          </div>
          <div class="ordak-loading" id="ordak-loading">
            <div class="ordak-spinner"></div>
            <p>Loading available slots...</p>
          </div>
          <div class="ordak-date-selector" id="ordak-date-selector" style="display:none;">
            <!-- Dates will be populated here -->
          </div>
          <div class="ordak-slots-container" id="ordak-slots-container" style="display:none;">
            <!-- Slots will be populated here -->
          </div>
          <div class="ordak-error" id="ordak-error" style="display:none;">
            <p class="ordak-error-message"></p>
          </div>
        </div>
      `;
    }

    async loadSlots() {
      try {
        const response = await fetch(`${WIDGET_API_BASE}/api/recommendations/slots`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fulfillmentType: this.options.fulfillmentType,
            locationId: this.options.locationId,
            customerId: this.options.customerId,
            customerEmail: this.options.customerEmail,
            deliveryAddress: this.options.deliveryAddress,
            dateRange: {
              startDate: new Date().toISOString().split('T')[0],
              endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
                .toISOString()
                .split('T')[0],
            },
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load slots');
        }

        this.slots = data.slots || [];
        this.hideLoading();

        if (this.slots.length === 0) {
          this.showError('No available slots found. Please try a different date range.');
          return;
        }

        // Track that recommendations were viewed
        this.trackRecommendationViewed();

        // Group slots by date
        this.renderDates();
      } catch (error) {
        console.error('Error loading slots:', error);
        this.hideLoading();
        this.showError('Failed to load available slots. Please try again.');
      }
    }

    hideLoading() {
      document.getElementById('ordak-loading').style.display = 'none';
    }

    showError(message) {
      const errorDiv = document.getElementById('ordak-error');
      errorDiv.querySelector('.ordak-error-message').textContent = message;
      errorDiv.style.display = 'block';
    }

    renderDates() {
      // Group slots by date
      const slotsByDate = this.slots.reduce((acc, slot) => {
        if (!acc[slot.date]) {
          acc[slot.date] = [];
        }
        acc[slot.date].push(slot);
        return acc;
      }, {});

      const dates = Object.keys(slotsByDate).sort();

      const dateSelector = document.getElementById('ordak-date-selector');
      dateSelector.style.display = 'block';

      // Clear previous content
      dateSelector.innerHTML = '';

      // Create dates container
      const datesDiv = this.createElement('div', 'ordak-dates');

      dates.forEach((date, index) => {
        const button = document.createElement('button');
        button.className = 'ordak-date-btn';
        if (index === 0) button.classList.add('active');
        button.setAttribute('data-date', date);
        button.onclick = () => window.ordakPicker.selectDate(date);
        button.textContent = this.formatDate(date);

        datesDiv.appendChild(button);
      });

      dateSelector.appendChild(datesDiv);

      // Show first date's slots by default
      this.selectDate(dates[0]);
    }

    selectDate(date) {
      // Update active date button
      document.querySelectorAll('.ordak-date-btn').forEach((btn) => {
        btn.classList.remove('active');
        if (btn.dataset.date === date) {
          btn.classList.add('active');
        }
      });

      // Show slots for this date
      const slotsForDate = this.slots.filter((slot) => slot.date === date);
      this.renderSlots(slotsForDate);
    }

    renderSlots(slots) {
      const container = document.getElementById('ordak-slots-container');
      container.style.display = 'block';

      // Sort by recommendation score
      const sortedSlots = [...slots].sort(
        (a, b) => b.recommendationScore - a.recommendationScore
      );

      // Clear previous content
      container.innerHTML = '';

      // Create slots container
      const slotsDiv = this.createElement('div', 'ordak-slots');

      sortedSlots.forEach((slot) => {
        const slotDiv = document.createElement('div');
        slotDiv.className = 'ordak-slot';
        if (slot.recommended) slotDiv.classList.add('recommended');
        if (slot.capacityRemaining === 0) slotDiv.classList.add('full');
        slotDiv.setAttribute('data-slot-id', slot.slotId);
        slotDiv.onclick = () => window.ordakPicker.selectSlot(slot.slotId);

        // Recommended badge
        if (slot.recommended) {
          const badge = this.createElement('span', 'ordak-badge', '⭐ Recommended');
          slotDiv.appendChild(badge);
        }

        // Slot time (safely escaped)
        const timeDiv = this.createElement('div', 'ordak-slot-time');
        timeDiv.textContent = `${slot.timeStart} - ${slot.timeEnd}`;
        slotDiv.appendChild(timeDiv);

        // Slot reason (safely escaped)
        const reasonDiv = this.createElement('div', 'ordak-slot-reason', slot.reason);
        slotDiv.appendChild(reasonDiv);

        // Capacity (safely escaped)
        const capacityDiv = this.createElement('div', 'ordak-slot-capacity');
        capacityDiv.textContent = `${slot.capacityRemaining} spots left`;
        slotDiv.appendChild(capacityDiv);

        // Full text
        if (slot.capacityRemaining === 0) {
          const fullText = this.createElement('div', 'ordak-slot-full-text', 'Fully Booked');
          slotDiv.appendChild(fullText);
        }

        slotsDiv.appendChild(slotDiv);
      });

      container.appendChild(slotsDiv);
    }

    selectSlot(slotId) {
      const slot = this.slots.find((s) => s.slotId === slotId);

      if (!slot || slot.capacityRemaining === 0) {
        return;
      }

      // Highlight selected slot
      document.querySelectorAll('.ordak-slot').forEach((el) => {
        el.classList.remove('selected');
      });
      document
        .querySelector(`[data-slot-id="${slotId}"]`)
        ?.classList.add('selected');

      this.selectedSlot = slot;

      // Track selection
      this.trackRecommendationSelected(slot);

      // Callback
      this.options.onSelect(slot);
    }

    formatDate(dateString) {
      const date = new Date(dateString + 'T00:00:00');
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      if (date.toDateString() === today.toDateString()) {
        return 'Today';
      } else if (date.toDateString() === tomorrow.toDateString()) {
        return 'Tomorrow';
      } else {
        return date.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
      }
    }

    async trackRecommendationViewed() {
      try {
        await fetch(`${WIDGET_API_BASE}/api/events/recommendation-viewed`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId: this.sessionId,
            customerId: this.options.customerId,
            customerEmail: this.options.customerEmail,
            shopifyDomain: SHOP_DOMAIN,
            recommendations: this.slots
              .filter((s) => s.recommended)
              .map((s) => ({
                type: 'slot',
                id: s.slotId,
                recommendationScore: s.recommendationScore,
              })),
          }),
        });
      } catch (error) {
        console.error('Failed to track recommendation view:', error);
      }
    }

    async trackRecommendationSelected(slot) {
      try {
        await fetch(`${WIDGET_API_BASE}/api/events/recommendation-selected`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId: this.sessionId,
            customerId: this.options.customerId,
            customerEmail: this.options.customerEmail,
            shopifyDomain: SHOP_DOMAIN,
            selected: {
              type: 'slot',
              id: slot.slotId,
              recommendationScore: slot.recommendationScore,
              wasRecommended: slot.recommended,
            },
            alternativesShown: this.slots
              .filter((s) => s.slotId !== slot.slotId && s.date === slot.date)
              .map((s) => s.slotId),
          }),
        });
      } catch (error) {
        console.error('Failed to track recommendation selection:', error);
      }
    }

    getSelectedSlot() {
      return this.selectedSlot;
    }
  }

  // Expose to global scope
  window.OrdakSlotPicker = OrdakSlotPicker;
})();
