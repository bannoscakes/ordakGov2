// Public terms of service. No auth required — App Store reviewers and
// merchants can read this from any browser. The Partners app listing
// can point its "Terms of service" field at https://ordak-go.vercel.app/policies/terms.

import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [
  { title: "Terms of service — Ordak Go" },
  {
    name: "description",
    content:
      "Terms of service for the Ordak Go Shopify app: what we provide, your responsibilities, and the limits of our liability.",
  },
];

const LAST_UPDATED = "2026-05-09";
const CONTACT_EMAIL = "panos@bannos.com.au";

export default function TermsOfService() {
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
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Terms of service</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Last updated: {LAST_UPDATED}
      </p>

      <p>
        These terms govern your use of the Ordak Go Shopify app
        ("Ordak Go", "we", "us", "our"). Ordak Go is operated by P&amp;T
        Group ("the publisher"). By installing Ordak Go on your Shopify
        store you agree to these terms. If you do not agree, do not
        install the app or uninstall it from your Shopify admin.
      </p>

      <h2 style={{ marginTop: 32 }}>1. What Ordak Go provides</h2>
      <p>
        Ordak Go adds delivery and pickup scheduling to a Shopify store.
        Specifically, the app provides:
      </p>
      <ul>
        <li>A cart-stage scheduling widget (theme app extension) that lets shoppers choose a delivery date, time slot, or pickup location before checkout.</li>
        <li>A Shopify Carrier Service callback that returns delivery rates based on the merchant&apos;s configured zones, slots, and pricing.</li>
        <li>A Shopify Delivery Customization Function that filters checkout shipping rates so they match the cart-stage choice.</li>
        <li>A Shopify Cart Validation Function that prevents express-checkout (Shop Pay, Apple Pay, Buy-it-now) when a scheduling choice is missing.</li>
        <li>An admin UI inside Shopify (locations, zones, slot templates, blackout dates, lead times, orders calendar, webhook destinations).</li>
        <li>Webhook handlers that record the chosen slot against each Shopify order.</li>
      </ul>

      <h2 style={{ marginTop: 32 }}>2. Eligibility</h2>
      <p>
        To use Ordak Go you must:
      </p>
      <ul>
        <li>Operate a Shopify store with the OAuth scopes the app requests at install (write_orders, read_locations, write_delivery_customizations, write_shipping, write_validations).</li>
        <li>Have authority to bind your business to these terms.</li>
        <li>Comply with the{" "}
          <a href="https://www.shopify.com/legal/api-terms" target="_blank" rel="noreferrer">Shopify API Terms of Service</a>{" "}and the{" "}
          <a href="https://www.shopify.com/legal/aup" target="_blank" rel="noreferrer">Shopify Acceptable Use Policy</a>.
        </li>
      </ul>

      <h2 style={{ marginTop: 32 }}>3. Pricing</h2>
      <p>
        Ordak Go is offered free of charge during its initial release.
        We may introduce paid tiers in the future. If we do, we will
        notify installed merchants at least 30 days in advance via in-app
        notice and email; merchants who do not wish to subscribe to a
        paid tier may uninstall the app without penalty.
      </p>
      <p>
        Some functionality depends on Shopify features that may carry
        their own fees independent of Ordak Go (for example,
        Carrier-Calculated Shipping is included on Shopify Advanced and
        higher plans, available as an add-on for Shopify plan accounts,
        and free on annual-billing or development stores). Ordak Go does
        not control those Shopify charges.
      </p>

      <h2 style={{ marginTop: 32 }}>4. Merchant responsibilities</h2>
      <p>
        As a merchant using Ordak Go, you are responsible for:
      </p>
      <ul>
        <li><strong>Accurate configuration.</strong> The delivery zones, pickup hours, slot capacity, lead times, blackout dates, and pricing you enter into the app drive what shoppers see and what they are charged. Review your settings before going live.</li>
        <li><strong>Order fulfillment.</strong> Ordak Go records the customer&apos;s scheduling choice; physically fulfilling the delivery or pickup at the chosen time is your responsibility.</li>
        <li><strong>Customer communication.</strong> Telling your customers what data is collected and how it is used (your own privacy policy must reference Ordak Go where relevant — see our privacy policy at <a href="/policies/privacy">/policies/privacy</a>).</li>
        <li><strong>Regulatory compliance.</strong> Compliance with consumer protection, food safety, delivery, and tax laws in the jurisdictions you serve.</li>
        <li><strong>Webhook destinations.</strong> If you configure outbound webhook destinations in the admin, you are responsible for the security and uptime of those destination URLs and for any data you forward to them.</li>
      </ul>

      <h2 style={{ marginTop: 32 }}>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use Ordak Go to violate any law or third-party right.</li>
        <li>Reverse engineer, decompile, or attempt to derive the source code of the app beyond what is permitted by applicable law.</li>
        <li>Probe, scan, or test the vulnerability of the app or its infrastructure without prior written consent.</li>
        <li>Send automated or scripted requests to Ordak Go endpoints in volumes designed to disrupt service or scrape merchant data. Storefront API endpoints are rate-limited; deliberate abuse may result in IP-level blocks and termination.</li>
        <li>Resell, sublicense, or transfer access to the app without our written consent.</li>
      </ul>

      <h2 style={{ marginTop: 32 }}>6. Intellectual property</h2>
      <p>
        Ordak Go and its source code, design, copy, and brand assets are
        owned by P&amp;T Group. Installing the app grants you a
        non-exclusive, non-transferable, revocable licence to use it on
        the Shopify store(s) where you have installed it for the duration
        of the install. You retain ownership of all data you input into
        the app (locations, zones, slots, rules, etc.).
      </p>

      <h2 style={{ marginTop: 32 }}>7. Service availability and changes</h2>
      <p>
        We aim for high availability but do not guarantee uninterrupted
        service. We may at any time and without prior notice:
      </p>
      <ul>
        <li>Modify or discontinue features.</li>
        <li>Perform maintenance that briefly affects availability.</li>
        <li>Update the app to track changes in the Shopify API or platform.</li>
      </ul>
      <p>
        Where a change materially reduces functionality you depend on,
        we will give merchants reasonable advance notice via in-app
        notice and the contact email on the install record.
      </p>

      <h2 style={{ marginTop: 32 }}>8. Disclaimer of warranty</h2>
      <p>
        Ordak Go is provided <strong>"as is" and "as available"</strong>{" "}
        without warranty of any kind, express or implied. To the maximum
        extent permitted by law, we disclaim all implied warranties
        including merchantability, fitness for a particular purpose, and
        non-infringement.
      </p>
      <p>
        We do not warrant that the app will be error-free, that defects
        will be corrected, or that scheduling decisions made by the app
        will always match merchant intent — these depend on your
        configuration. You should test your configuration on a
        development store before exposing it to live customers.
      </p>

      <h2 style={{ marginTop: 32 }}>9. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, P&amp;T Group&apos;s
        aggregate liability arising out of or relating to the app,
        whether in contract, tort, or otherwise, will not exceed the
        greater of (a) the fees you paid us for the app in the twelve
        months preceding the claim, or (b) one hundred Australian
        dollars (A$100). Because Ordak Go is currently free, this
        effectively caps liability at A$100.
      </p>
      <p>
        Neither party will be liable for indirect, incidental, special,
        consequential, or exemplary damages, including lost profits,
        lost revenue, lost orders, lost goodwill, or business
        interruption — even if advised of the possibility of such
        damages.
      </p>
      <p>
        Nothing in these terms excludes liability that cannot be
        excluded under applicable consumer protection law (for Australian
        merchants: the Australian Consumer Law).
      </p>

      <h2 style={{ marginTop: 32 }}>10. Indemnity</h2>
      <p>
        You agree to indemnify and hold harmless P&amp;T Group, its
        directors, employees, and agents from any claim, loss, or
        expense (including reasonable legal fees) arising out of your
        misuse of the app, your breach of these terms, or your
        violation of any third-party right or law.
      </p>

      <h2 style={{ marginTop: 32 }}>11. Termination</h2>
      <p>
        You may terminate these terms at any time by uninstalling Ordak
        Go from your Shopify admin. Uninstall triggers Shopify&apos;s{" "}
        <code>app/uninstalled</code> webhook, after which we delete your
        shop&apos;s data per our{" "}
        <a href="/policies/privacy">privacy policy</a>.
      </p>
      <p>
        We may suspend or terminate your access to Ordak Go without
        prior notice if you (a) breach these terms, (b) use the app in a
        way that endangers other merchants or our infrastructure, or (c)
        Shopify suspends or terminates your Shopify account.
      </p>

      <h2 style={{ marginTop: 32 }}>12. Governing law and disputes</h2>
      <p>
        These terms are governed by the laws of New South Wales,
        Australia. Each party submits to the non-exclusive jurisdiction
        of the courts of New South Wales for any dispute arising out of
        or relating to these terms or the app, except where mandatory
        consumer protection law in your own jurisdiction requires
        otherwise.
      </p>

      <h2 style={{ marginTop: 32 }}>13. Changes to these terms</h2>
      <p>
        We may update these terms from time to time. We will update the
        "Last updated" date at the top of this page and, for material
        changes, give merchants notice via in-app banner before the
        change takes effect. Continued use of Ordak Go after the
        effective date constitutes acceptance of the updated terms.
      </p>

      <h2 style={{ marginTop: 32 }}>14. Contact</h2>
      <p>
        Questions about these terms:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </main>
  );
}
