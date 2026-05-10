import { render } from "preact";
import { OrdakApi } from "./api";
import type { BlockConfig } from "./types";
import { CartScheduler } from "./components/CartScheduler";

const APP_BLOCK_ATTR = "data-ordak-cart-scheduler";
const EMBED_ATTR = "data-ordak-cart-scheduler-embed";
const MOUNTED_FLAG = "data-ordak-mounted";

// Express checkout button selectors. Mirrors the CSS hide-list in
// cart-scheduler-embed.liquid so the detector reports back when buttons
// remain visible (theme-specific class, hide-toggle off, etc).
const EXPRESS_BUTTON_SELECTORS = [
  ".shopify-payment-button",
  ".additional-checkout-buttons",
  '[data-testid="dynamic-checkout-cart"]',
  '[data-testid*="dynamic-checkout"]',
  "[data-shopify-buttoncontainer]",
  ".dynamic-checkout__buttons",
].join(", ");

function detectVisibleExpressButtons(): boolean {
  const matches = document.querySelectorAll(EXPRESS_BUTTON_SELECTORS);
  for (const el of Array.from(matches)) {
    if (!(el instanceof HTMLElement)) continue;
    // offsetParent is null when display: none (the hide-CSS works), so any
    // truthy offsetParent means the button is rendering somewhere.
    if (el.offsetParent !== null) return true;
  }
  return false;
}

let diagnosticsReported = false;
function reportDiagnosticsOnce(config: BlockConfig) {
  if (diagnosticsReported) return;
  diagnosticsReported = true;
  try {
    const api = new OrdakApi(config);
    api.reportDiagnostics({
      expressButtonsVisible: detectVisibleExpressButtons(),
      surface: config.surface,
    });
  } catch {
    // Diagnostics are passive — never block mount on a telemetry failure.
  }
}

function readConfig(host: Element): BlockConfig | null {
  const node = host.querySelector("script[type='application/json'][data-ordak-config]");
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as BlockConfig;
  } catch {
    return null;
  }
}

function mountInto(host: Element) {
  if (host.hasAttribute(MOUNTED_FLAG)) return;
  const config = readConfig(host);
  if (!config) return;
  host.setAttribute(MOUNTED_FLAG, "1");
  if (host.hasAttribute("hidden")) host.removeAttribute("hidden");
  render(<CartScheduler config={config} rootEl={host} />, host);
  // Fire diagnostics once we have a config to address the proxy with.
  // Defer slightly so the theme has a chance to render express buttons
  // before we measure their visibility — themes lazy-load the dynamic
  // checkout buttons after first paint.
  setTimeout(() => reportDiagnosticsOnce(config), 1500);
}

function lazyMount(host: Element) {
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.disconnect();
            mountInto(host);
            return;
          }
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(host);
  } else {
    mountInto(host);
  }
}

function findEmbedDrawer(host: Element): Element | null {
  const selector = host.getAttribute("data-ordak-drawer-selector");
  if (!selector) return null;
  return document.querySelector(selector);
}

function bootstrapEmbed(host: Element) {
  // Mount lazily once the drawer DOM appears AND becomes visible.
  let drawer = findEmbedDrawer(host);
  if (!drawer) {
    const mo = new MutationObserver(() => {
      drawer = findEmbedDrawer(host);
      if (drawer) {
        mo.disconnect();
        observeDrawer(host, drawer);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return;
  }
  observeDrawer(host, drawer);
}

// Find the best location inside the drawer to host the widget. Strategy
// is to land just above the checkout button (typical theme layout: items
// → subtotal → widget → checkout button). Falls back through several
// progressively-broader containers so unfamiliar themes still get a
// reasonable placement.
//
// Selector priority is critical here: a previous version used
// `querySelector('button[name="checkout"], [name="checkout"], button[type="submit"]')`
// which returns the first match in DOM order across the WHOLE list — not
// the first selector's match. On Horizon's drawer that picked Discount's
// "Apply" submit button (or our own postcode "Check") instead of the real
// checkout, nesting the embed inside the wrong form. This implementation
// prefers the named checkout, and only falls back to a generic submit
// button when it's scoped inside a known footer/CTA container AND not
// inside any sibling form (Discount, our postcode row, our own embed).
export function findHostTarget(drawer: Element): { parent: Element; before: Element | null } {
  let checkout: Element | null = drawer.querySelector(
    'button[name="checkout"], [name="checkout"]',
  );

  if (!checkout) {
    const candidates = drawer.querySelectorAll('button[type="submit"]');
    for (const btn of Array.from(candidates)) {
      if (
        btn.closest(
          '.cart-discount__form, .ordak-postcode__row, [data-ordak-cart-scheduler-embed], [data-ordak-cart-scheduler]',
        )
      ) {
        continue;
      }
      if (
        btn.closest(
          '.cart-drawer__footer, .drawer__footer, .cart__footer, .cart__ctas, .totals',
        )
      ) {
        checkout = btn;
        break;
      }
    }
  }

  const ctas = checkout?.closest(
    '.cart-drawer__footer, .drawer__footer, .cart__footer, .cart__ctas, .totals',
  );
  if (ctas?.parentElement) {
    return { parent: ctas.parentElement, before: ctas };
  }
  if (checkout?.parentElement) {
    return { parent: checkout.parentElement, before: checkout };
  }
  const inner = drawer.querySelector(
    '.drawer__inner, .cart-drawer__inner, .cart-drawer__form, .cart__contents',
  );
  if (inner) {
    return { parent: inner, before: null };
  }
  return { parent: drawer, before: null };
}

function placeHost(host: Element, drawer: Element) {
  const { parent, before } = findHostTarget(drawer);
  if (before) {
    if (host.previousElementSibling !== before.previousElementSibling || host.parentElement !== parent) {
      parent.insertBefore(host, before);
    }
  } else if (host.parentElement !== parent) {
    parent.appendChild(host);
  }
}

// Remove duplicate cart-block hosts. After Horizon's cart-items-component
// section render, the new HTML often includes a fresh empty
// `<div data-ordak-cart-scheduler-embed>` matching our selector. Our
// MutationObserver re-attaches the OLD host (which has the live Preact
// tree mounted on it), but the NEW empty host is also in the DOM. Both
// are visually identical because they share the same liquid output, so
// the customer often clicks the empty one and nothing happens (the
// listeners and signal-connected children only exist on OUR host).
//
// Identify ours by MOUNTED_FLAG — set during mountInto. Anything else
// matching the selector is a duplicate from a section re-render or a
// theme that injects the embed twice; safe to drop.
function sweepDuplicateHosts(ours: Element) {
  const all = document.querySelectorAll(`[${EMBED_ATTR}]`);
  for (const el of Array.from(all)) {
    if (el === ours) continue;
    if (el.hasAttribute(MOUNTED_FLAG)) continue;
    el.parentElement?.removeChild(el);
  }
}

function observeDrawer(host: Element, drawer: Element) {
  placeHost(host, drawer);

  // Mount eagerly. Most themes' cart drawers are `position: fixed` and
  // hidden via visibility/transform — `offsetParent` is null even when
  // the drawer is open (Dawn pattern), and detecting "is the drawer open"
  // across themes is fragile. The mounted Preact tree is cheap to keep
  // around; user-visible work (slot fetch) only fires on interaction. So
  // we mount once and let the theme's own toggle show/hide the container.
  mountInto(host);

  // First-open race fix (2026-05-09): we used to only call placeHost when
  // `!drawer.contains(host)`. That misses the common Horizon path where
  //   1. On script load, the drawer's checkout button hasn't been
  //      materialized yet (drawer body is just a <template>). findHostTarget
  //      falls through to its last-resort `{parent: drawer, before: null}`
  //      and the host is appended to the drawer root.
  //   2. User clicks the cart icon. Horizon renders the cart UI by ADDING
  //      siblings around our host (it doesn't innerHTML-replace on first
  //      render). Our host is still a direct child of drawer, just at the
  //      wrong slot.
  //   3. drawer.contains(host) is still true — old reinsert no-op'd.
  //   4. Widget stays at drawer root, hidden / off-position.
  // Calling placeHost unconditionally fixes this: placeHost is idempotent
  // (lines 174 + 177 short-circuit when the host is already at the correct
  // slot), so re-running on every drawer mutation only does work when the
  // ideal slot has shifted.
  //
  // Debounce via rAF because subtree:true catches mutations from the
  // cart-block's OWN Preact renders inside the host (postcode keystrokes,
  // slot tile hover state, etc.). Without throttling, every keystroke
  // re-runs findHostTarget. The rAF flush coalesces a burst of mutations
  // into one placeHost call per frame.
  let scheduled = false;
  const reinsert = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      // Sweep first so placeHost works on a clean DOM. After a section
      // re-render the duplicate empty host can sit at our target slot
      // and confuse findHostTarget (e.g. its checkout button is the
      // first match in DOM order). Removing duplicates first means
      // placeHost lands our mounted host at the right spot.
      sweepDuplicateHosts(host);
      placeHost(host, drawer);
    });
  };
  // `cart:update` (singular) is what Horizon's cart Web Components
  // dispatch on Add-to-Cart. The plural names cover Dawn-derivative
  // themes. Listening at document level catches bubbled events from any
  // theme.
  ["cart:update", "cart:updated", "cart:refresh", "cart-updated"].forEach((evt) => {
    document.addEventListener(evt, reinsert);
  });
  const mo = new MutationObserver(reinsert);
  mo.observe(drawer, { childList: true, subtree: true });
}

function init() {
  document.querySelectorAll(`[${APP_BLOCK_ATTR}]`).forEach((el) => lazyMount(el));
  document.querySelectorAll(`[${EMBED_ATTR}]`).forEach((el) => bootstrapEmbed(el));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
