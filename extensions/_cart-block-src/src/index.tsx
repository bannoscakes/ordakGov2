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

// Legacy accent some early installs grandfathered before PR #128 swapped the
// brand color to orange. Liquid renders block.settings.accent_color verbatim,
// so a stored `#1a73e8` keeps shipping even though the schema default is
// now `#EB5E14`. Normalize to lowercase before comparing.
const LEGACY_ACCENT = "#1a73e8";
const BRAND_ACCENT = "#EB5E14";

function maybeOverrideLegacyAccent(host: Element) {
  if (!(host instanceof HTMLElement)) return;
  const current = getComputedStyle(host).getPropertyValue("--ordak-accent").trim().toLowerCase();
  if (current === LEGACY_ACCENT) {
    host.style.setProperty("--ordak-accent", BRAND_ACCENT);
  }
}

function mountInto(host: Element) {
  if (host.hasAttribute(MOUNTED_FLAG)) return;
  const config = readConfig(host);
  if (!config) return;
  host.setAttribute(MOUNTED_FLAG, "1");
  if (host.hasAttribute("hidden")) host.removeAttribute("hidden");
  maybeOverrideLegacyAccent(host);
  // Liquid renders <script type="application/json"> + <noscript> as
  // children of the host. Preact's render(jsx, parent) preserves any
  // existing children that don't appear in the JSX tree — those leftover
  // nodes confuse Preact's diff bookkeeping enough that the resulting
  // buttons get `.l[clickfalse]` set on the DOM expando but the
  // `addEventListener('click', eventProxy)` registration is skipped. The
  // visible symptom is buttons that look right but never respond to real
  // clicks. Stripping the host clean before render avoids the trap.
  // Config was already extracted above so the script tag is no longer
  // needed; the noscript is a graceful-degradation hint that's redundant
  // once JS has confirmed mount.
  while (host.firstChild) host.removeChild(host.firstChild);
  render(<CartScheduler config={config} rootEl={host} />, host);
  // Fire diagnostics once we have a config to address the proxy with.
  // Defer slightly so the theme has a chance to render express buttons
  // before we measure their visibility — themes lazy-load the dynamic
  // checkout buttons after first paint.
  setTimeout(() => reportDiagnosticsOnce(config), 1500);
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

function observeDrawer(host: Element, initialDrawer: Element) {
  // The drawer reference can become stale: Horizon's cart-drawer-component
  // may be re-rendered (or even replaced) when a customer adds the first
  // item to cart. Re-resolve every time we touch placement so we never
  // operate against a detached element.
  let drawer: Element = initialDrawer;
  function resolveDrawer(): Element | null {
    if (drawer.isConnected) return drawer;
    const fresh = findEmbedDrawer(host);
    if (fresh) drawer = fresh;
    return drawer.isConnected ? drawer : null;
  }

  placeHost(host, drawer);

  // Mount eagerly. Most themes' cart drawers are `position: fixed` and
  // hidden via visibility/transform — `offsetParent` is null even when
  // the drawer is open (Dawn pattern), and detecting "is the drawer open"
  // across themes is fragile. The mounted Preact tree is cheap to keep
  // around; user-visible work (slot fetch) only fires on interaction. So
  // we mount once and let the theme's own toggle show/hide the container.
  mountInto(host);

  // First-open race + cart-refresh race: Horizon refreshes the cart
  // drawer's contents by replacing children of `.cart-drawer__inner` (and
  // sometimes the entire cart-drawer-component). When that happens our
  // host gets removed from DOM. We re-attach by:
  //   (a) running placeHost on every cart event Horizon fires
  //   (b) running placeHost on every relevant DOM mutation
  // Observing document.body (instead of just the drawer) means we still
  // catch mutations even after the drawer reference goes stale — the body
  // observer survives a drawer swap.
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
      const d = resolveDrawer();
      if (!d) return;
      placeHost(host, d);
    });
  };
  ["cart:updated", "cart:refresh", "cart-updated"].forEach((evt) => {
    document.addEventListener(evt, reinsert);
  });
  const mo = new MutationObserver(reinsert);
  mo.observe(document.body, { childList: true, subtree: true });
}

function init() {
  // Cart-page surface: mount eagerly. The widget IS the page on /cart, and
  // the host renders at 32×32 with no children of intrinsic height, which
  // lets IntersectionObserver mis-fire on some themes (Horizon's cart page
  // never crossed the 200px-rootMargin threshold). lazyMount still has a
  // setTimeout safety net for any other surface that opts into it.
  document.querySelectorAll(`[${APP_BLOCK_ATTR}]`).forEach((el) => mountInto(el));
  document.querySelectorAll(`[${EMBED_ATTR}]`).forEach((el) => bootstrapEmbed(el));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
