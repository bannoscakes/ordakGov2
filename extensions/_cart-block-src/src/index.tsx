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
function findHostTarget(drawer: Element): { parent: Element; before: Element | null } {
  const checkout = drawer.querySelector(
    'button[name="checkout"], [name="checkout"], button[type="submit"]',
  );
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
