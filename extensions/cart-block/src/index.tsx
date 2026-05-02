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

function observeDrawer(host: Element, drawer: Element) {
  // Move the host into the drawer so it lives inside the off-canvas container.
  if (drawer && !drawer.contains(host)) drawer.appendChild(host);

  const config = readConfig(host);
  if (!config) return;

  const tryMount = () => {
    const visible = (drawer as HTMLElement).offsetParent !== null;
    if (visible) mountInto(host);
  };

  tryMount();

  // Watch for class/attribute toggles indicating the drawer opened.
  const mo = new MutationObserver(tryMount);
  mo.observe(drawer, { attributes: true, attributeFilter: ["class", "open", "aria-hidden"] });
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
