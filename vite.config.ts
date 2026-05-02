import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    // Allow the embedded admin to reach our dev server through any cloudflared
    // quick-tunnel subdomain. Quick-tunnel hostnames change every restart, so
    // we permit the whole `*.trycloudflare.com` zone rather than pinning one.
    // Also allow `localhost` for direct local testing.
    allowedHosts: [".trycloudflare.com", "localhost"],
  },
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
      },
    }),
    tsconfigPaths(),
  ],
});
