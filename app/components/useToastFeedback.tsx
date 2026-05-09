import { useCallback } from "react";

// App Bridge React 4.x exposes a global `shopify.toast.show()` that renders
// toasts at the embedded-admin level. This sidesteps Polaris's Toast which
// requires a Frame wrapper our app shell doesn't include.
//
// The `shopify` global is augmented onto globalThis by @shopify/app-bridge-types
// — it's only defined inside the embedded admin iframe, so the call is no-op
// during SSR.

export function useToastFeedback(): {
  showToast: (message: string, opts?: { error?: boolean; duration?: number }) => void;
} {
  const showToast = useCallback(
    (message: string, opts?: { error?: boolean; duration?: number }) => {
      if (typeof window === "undefined") return;
      const tryShow = (attempt: number) => {
        const sb = (globalThis as { shopify?: { toast?: { show: (msg: string, o?: unknown) => unknown } } }).shopify;
        if (sb?.toast?.show) {
          sb.toast.show(message, {
            isError: opts?.error ?? false,
            duration: opts?.duration ?? 3000,
          });
          return;
        }
        // App Bridge global hasn't hydrated yet — retry once on the next
        // animation frame. After that, log so debug builds surface the
        // missed feedback instead of silently no-op'ing.
        if (attempt === 0) {
          requestAnimationFrame(() => tryShow(1));
          return;
        }
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ordak] toast skipped: shopify.toast not ready", { message });
        }
      };
      tryShow(0);
    },
    [],
  );
  return { showToast };
}
