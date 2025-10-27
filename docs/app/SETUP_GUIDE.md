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

7. **Configure recommendation settings (optional)**
   - Navigate to **Recommendation Settings** in the app admin panel.
   - **Enable/Disable**: Toggle the recommendation engine on or off globally. When enabled, customers will see "Recommended" badges on optimal slots and locations.
   - **Weighting Factors**: Adjust how the recommendation algorithm prioritizes different factors:
     - **Capacity**: Higher weight = prioritize slots with more availability.
     - **Distance**: Higher weight = prioritize nearest pickup locations.
     - **Route Efficiency**: Higher weight = prioritize slots that cluster deliveries geographically (requires routing integration).
     - **Personalization**: Higher weight = prioritize slots similar to customer's past selections.
   - **Number of Alternatives**: Set how many alternative slots to show when a customer's preferred time is unavailable (default: 3).
   - **Location Coordinates**: Ensure all your pickup locations have accurate latitude/longitude set for distance calculations. The app can auto‑populate these from Shopify location addresses.
   - **Analytics Dashboard**: Review recommendation adoption rates to see how often customers choose recommended slots vs. other options. Use this data to fine‑tune your settings.

8. **Test recommendations on your Test store**
   - With recommendations enabled, open the cart widget and verify that:
     - The top‑recommended slot has a "Recommended" badge.
     - A brief reason is displayed (e.g., "Most available capacity").
     - When multiple pickup locations are available, they're sorted by distance with the nearest marked as recommended.
   - Try selecting a fully booked slot (if any) and confirm that alternative suggestions appear.
   - Complete a test order with a recommended slot and check that the order tags include `recommended-slot`.
   - Review the analytics dashboard to confirm recommendation events are being logged.

This setup guide ensures merchants can quickly configure and validate the scheduling app with real data, minimising surprises during launch.
