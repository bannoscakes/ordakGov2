// Public privacy policy. No auth required — App Store reviewers and
// merchants can read this from any browser. The Partners app listing
// points its "Privacy policy" field at https://ordak-go.vercel.app/policies/privacy.

import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [
  { title: "Privacy policy — Ordak Go" },
  {
    name: "description",
    content:
      "Privacy policy for the Ordak Go Shopify app: what data we collect, how we use it, and how to contact us.",
  },
];

const LAST_UPDATED = "2026-05-05";
const CONTACT_EMAIL = "panos@bannos.com.au";

export default function PrivacyPolicy() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: "#1f2937",
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Privacy policy</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Last updated: {LAST_UPDATED}
      </p>

      <p>
        This privacy policy explains how the Ordak Go Shopify app
        ("Ordak Go", "we", "us") collects, uses, and protects information
        when a Shopify merchant installs it on their store and a customer
        of that merchant interacts with it. Ordak Go is operated by P&amp;T
        Group, who can be contacted at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2 style={{ marginTop: 32 }}>What Ordak Go does</h2>
      <p>
        Ordak Go adds delivery and pickup scheduling to a merchant's
        Shopify storefront. A customer chooses a delivery date, time
        slot, or pickup location during the checkout process; the
        merchant configures available zones, slots, and pricing in the
        app's admin.
      </p>

      <h2 style={{ marginTop: 32 }}>What information we collect</h2>
      <p>
        <strong>From the merchant:</strong> the Shopify shop domain,
        OAuth access tokens for the scopes the merchant grants at
        install (write_orders, read_locations, write_delivery_customizations,
        write_shipping, write_validations), shop locations and addresses,
        and any zones/slots/rules the merchant configures.
      </p>
      <p>
        <strong>From the customer (during a Shopify order):</strong>{" "}
        the customer's email address, phone number, and delivery address
        — only when the customer chooses delivery. We receive these
        through Shopify's <code>orders/create</code> webhook AFTER
        Shopify itself has captured them as part of the merchant's
        own order. We use them only to record which delivery time slot
        was reserved and to allow the merchant to look up scheduling
        details for that order.
      </p>
      <p>
        <strong>From the storefront (technical):</strong> the
        customer's postcode (entered into the cart-block) is sent to
        our app to determine which delivery zone they fall into. We do
        not retain the postcode after the eligibility check; the
        customer's order then carries it through Shopify's regular
        order pipeline.
      </p>
      <p>
        We do <strong>not</strong> collect: payment information,
        Shopify password or login credentials, browsing history outside
        the cart-block, IP addresses for tracking, or any third-party
        analytics fingerprints.
      </p>

      <h2 style={{ marginTop: 32 }}>How we use the information</h2>
      <ul>
        <li>To compute delivery rates at checkout (per-zone base price plus per-slot premium).</li>
        <li>To record the chosen time slot against the merchant's order so the merchant can fulfill the delivery or pickup at the right time.</li>
        <li>To respond to support requests from the merchant about a specific order.</li>
        <li>To respond to GDPR-style data requests forwarded from Shopify (see &quot;Customer rights&quot; below).</li>
      </ul>
      <p>
        We do <strong>not</strong> use customer information for
        marketing, advertising, profiling, or to train machine-learning
        models. We do not sell or rent any data.
      </p>

      <h2 style={{ marginTop: 32 }}>Where we store the information</h2>
      <p>
        Customer and merchant data is stored in a PostgreSQL database
        hosted by Supabase in the <code>ap-southeast-2</code> (Sydney,
        Australia) region. Application code runs on Vercel serverless
        functions, also pinned to the Sydney region. We do not transfer
        data outside Australia for routine operations. Database backups
        are managed by Supabase under their standard data protection
        terms.
      </p>

      <h2 style={{ marginTop: 32 }}>Who we share the information with</h2>
      <p>
        We do <strong>not</strong> share customer information with
        third parties. The merchant who installed Ordak Go is the
        controller of their customers' data; we are a processor on
        their behalf.
      </p>
      <p>
        The merchant may, at their own discretion, configure outbound
        webhook destinations (in the app's Settings &rarr; Integrations
        admin) that forward order/scheduling events to systems they
        operate (their own ERP, delivery routing software, etc.). Those
        destinations are off by default and require the merchant to
        explicitly enable each one. When enabled, Ordak Go forwards a
        signed JSON payload to the URL the merchant configured. We do
        not control or monitor those destinations.
      </p>

      <h2 style={{ marginTop: 32 }}>How long we keep the information</h2>
      <p>
        Order scheduling records are kept for as long as the merchant
        keeps Ordak Go installed and the corresponding Shopify order
        exists. When the merchant uninstalls the app, Shopify sends an{" "}
        <code>app/uninstalled</code> webhook and we delete the
        merchant's shop record from our database immediately. Order
        records are subject to Shopify's GDPR <code>shop/redact</code>{" "}
        webhook (typically 48 hours after uninstall), at which point we
        delete the remaining shop data.
      </p>
      <p>
        Customer-specific data (email, phone, delivery address on
        OrderLink rows; CustomerPreferences; RecommendationLog) is also
        deleted on demand via Shopify's GDPR{" "}
        <code>customers/redact</code> webhook — see &quot;Customer
        rights&quot; below.
      </p>

      <h2 style={{ marginTop: 32 }}>Customer rights (GDPR / CCPA-style requests)</h2>
      <p>
        Customers who have ordered from a Shopify store running Ordak
        Go can request access to or deletion of their data by
        contacting the merchant directly (the data controller). The
        merchant initiates the request from inside their Shopify admin;
        Shopify forwards the request to Ordak Go via the GDPR webhook
        topics:
      </p>
      <ul>
        <li>
          <code>customers/data_request</code> — Ordak Go logs receipt
          and surfaces the customer's stored data to the merchant via
          the in-app <code>/app/data-requests</code> page (a JSON
          export). The merchant forwards it to the customer.
        </li>
        <li>
          <code>customers/redact</code> — Ordak Go anonymises the
          customer's order links (sets email/phone/address to{" "}
          <code>null</code>), deletes their{" "}
          <code>CustomerPreferences</code> row, and deletes their{" "}
          <code>RecommendationLog</code> rows.
        </li>
        <li>
          <code>shop/redact</code> — Ordak Go deletes all the
          merchant's shop data (location, zone, rule, slot, order link,
          and shop records).
        </li>
      </ul>
      <p>
        Customers may also contact us directly at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> for
        questions about how Ordak Go processes their data; we will
        respond within 30 days.
      </p>

      <h2 style={{ marginTop: 32 }}>Security</h2>
      <p>
        OAuth tokens are stored encrypted at rest by Supabase. All
        traffic between the storefront, Ordak Go, and Shopify uses
        HTTPS (TLS 1.2 or higher). Webhook payloads from Shopify are
        verified with HMAC-SHA256 signatures before processing.
        Outbound webhook destinations configured by the merchant are
        signed with HMAC using a secret the merchant rotates from the
        Settings page.
      </p>

      <h2 style={{ marginTop: 32 }}>Children</h2>
      <p>
        Ordak Go does not knowingly collect data from children under
        the age of 13 (or the local equivalent age of digital consent).
        If you believe a child has interacted with a Shopify store
        running Ordak Go and provided personal data, contact the
        merchant or us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will delete the records.
      </p>

      <h2 style={{ marginTop: 32 }}>Changes to this policy</h2>
      <p>
        We will update the &quot;Last updated&quot; date at the top of
        this page if we change the policy materially. Significant
        changes will also be communicated to merchants via in-app
        notice when they next open the Ordak Go admin.
      </p>

      <h2 style={{ marginTop: 32 }}>Contact</h2>
      <p>
        Questions about this policy or about how Ordak Go handles
        data:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </main>
  );
}
