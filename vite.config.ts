import { vitePlugin as remix } from "@remix-run/dev";
import { vercelPreset } from "@vercel/remix/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    // Stable named tunnel (dev.ordak.vip) is the primary path. The
    // .trycloudflare.com wildcard stays in case anyone falls back to a quick
    // tunnel for one-off debugging.
    allowedHosts: ["dev.ordak.vip", ".trycloudflare.com", "localhost"],
  },
  plugins: [
    remix({
      presets: [vercelPreset()],
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
