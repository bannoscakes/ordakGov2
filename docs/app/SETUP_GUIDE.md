# MERCHANT SETUP GUIDE

Follow these steps to configure the Delivery & Pickup Scheduler app on your Shopify store. Because the app uses real data, always use your **Test store** for initial setup and verification before rolling out to a live store.

1. **Connect locations**
   - In the app’s admin panel, go to **Locations**.
   - Click **Add location** and choose your existing Shopify locations or create new ones. Give each location a descriptive name (e.g., “Sydney Warehouse” or “Bondi Pickup Counter”).
   - Ensure each location has the correct address and timezone set in Shopify.

2. **Create zones & postcodes**
   - Navigate to **Zones** and click **Create zone**.
   - Define your delivery areas using postcode ranges, lists, or radius (km/miles) based on the location’s address.
   - Assign each zone to one or more locations and specify whether the zone supports delivery, pickup, or both.

3. **Define rules**
   - In the **Rules** section, create rules that control when orders can be scheduled:
     - **Cut‑off time**: The time of day after which same‑day orders are no longer accepted.
     - **Lead time**: Minimum number of hours or days between order placement and the earliest available slot.
     - **Blackout dates**: Dates when delivery or pickup is unavailable (e.g., holidays).
     - **Slot duration & capacity**: Length of each time slot (e.g., 30 minutes) and how many orders can be booked per slot.

4. **Set slot capacities**
   - Within each rule or schedule, set the maximum number of deliveries or pickups per time slot. This prevents overbooking and ensures staff can fulfil orders on time.
   - You can override capacity per location or per zone if needed.

5. **Style the widget**
   - Go to **Widget settings** to customise the look and feel of the scheduling widget.
   - Adjust colours, fonts, and labels to match your theme. Use Shopify’s theme editor preview to see the widget in context.

6. **Verify on your Test store**
   - After configuring locations, zones, and rules, install the app on your Shopify **Test store**.
   - Add a product to your cart, open the cart or mini‑cart, and ensure the scheduling widget appears.
   - Test both delivery and pickup flows with eligible and ineligible postcodes. Complete a test order and confirm the order metafields/tags reflect the selected options.
   - If everything looks correct, repeat the steps on your live store. Otherwise, adjust your zones, rules, or widget styling as needed.

This setup guide ensures merchants can quickly configure and validate the scheduling app with real data, minimising surprises during launch.
