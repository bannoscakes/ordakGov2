import { render } from "preact";
import type { BlockConfig } from "./types";
import { CartScheduler } from "./components/CartScheduler";

const APP_BLOCK_ATTR = "data-ordak-cart-scheduler";
const EMBED_ATTR = "data-ordak-cart-scheduler-embed";
const MOUNTED_FLAG = "data-ordak-mounted";

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
// IMPORTANT — bug fix history (2026-05-06): the original selector list
// included `button[type="submit"]` as a fallback. That's too greedy on
// modern themes that include a Discount form (Shopify Horizon does):
// the discount-form's "Apply" button is also `type="submit"`. And once
// our own widget has mounted, our postcode-row's "Check" button is
// also `type="submit"`. `querySelector` with a comma-separated selector
// list returns the FIRST element matching ANY selector in DOM order —
// so on Horizon, the embed got placed inside the discount form (or
// inside its own postcode row on re-render). Visible symptom: cart-block
// "hides behind Discount" or appears nested inside its own UI.
//
// Fix: only ever match `name="checkout"` (Shopify's standard checkout
// button convention) — never any `button[type="submit"]`. If a theme
// has no `name="checkout"` button, fall through to known footer/inner
// container classes, then to the drawer itself. We do not try to
// "discover" the checkout button via type=submit.
function findHostTarget(drawer: Element): { parent: Element; before: Element | null } {
  // 1. Prefer Shopify's `name="checkout"` button — the convention used
  //    by Dawn, Horizon, Refresh, and every Online Store 2.0 theme. We
  //    place the widget just above its CTA container so it reads as
  //    "items → subtotal → widget → checkout."
  const named = drawer.querySelector(
    'button[name="checkout"], [name="checkout"]',
  );
  if (named) {
    const ctas = named.closest(
      '.cart-drawer__footer, .drawer__footer, .cart__footer, .cart__ctas, .totals',
    );
    if (ctas?.parentElement) {
      return { parent: ctas.parentElement, before: ctas };
    }
    if (named.parentElement) {
      return { parent: named.parentElement, before: named };
    }
  }

  // 2. No name="checkout" button — match a known footer/cta class
  //    directly. Place above it.
  const footer = drawer.querySelector(
    '.cart-drawer__footer, .drawer__footer, .cart__footer, .cart__ctas, .totals',
  );
  if (footer?.parentElement) {
    return { parent: footer.parentElement, before: footer };
  }

  // 3. No footer found — append inside an "inner" container (cart body)
  //    so we land below the line items.
  const inner = drawer.querySelector(
    '.drawer__inner, .cart-drawer__inner, .cart-drawer__form, .cart__contents',
  );
  if (inner) {
    return { parent: inner, before: null };
  }

  // 4. Last resort: append to drawer root.
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

function observeDrawer(host: Element, drawer: Element) {
  placeHost(host, drawer);

  // Mount eagerly. Most themes' cart drawers are `position: fixed` and
  // hidden via visibility/transform — `offsetParent` is null even when
  // the drawer is open (Dawn pattern), and detecting "is the drawer open"
  // across themes is fragile. The mounted Preact tree is cheap to keep
  // around; user-visible work (slot fetch) only fires on interaction. So
  // we mount once and let the theme's own toggle show/hide the container.
  mountInto(host);

  // Themes typically re-render the cart drawer's inner HTML on AJAX cart
  // updates — which our own /cart/update.js + /cart/change.js writes
  // trigger. When that happens our host element is detached (but the
  // Preact tree on it stays alive), so reinsert it into the new DOM.
  // Preact state survives the move because the host node is the same.
  const reinsert = () => {
    if (!drawer.contains(host)) {
      placeHost(host, drawer);
    }
  };
  ["cart:updated", "cart:refresh", "cart-updated"].forEach((evt) => {
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
