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
      const sb = (globalThis as { shopify?: { toast?: { show: (msg: string, o?: unknown) => unknown } } }).shopify;
      if (!sb?.toast?.show) return;
      sb.toast.show(message, {
        isError: opts?.error ?? false,
        duration: opts?.duration ?? 3000,
      });
    },
    [],
  );
  return { showToast };
}
