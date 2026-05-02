import { build, context } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

const BUDGET_BYTES = 35 * 1024;

const config = {
  entryPoints: [resolve(__dirname, "src/index.tsx")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  sourcemap: true,
  outfile: resolve(__dirname, "../cart-block/assets/cart-scheduler.js"),
  jsx: "automatic",
  jsxImportSource: "preact",
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  logLevel: "info",
};

function reportSize() {
  try {
    const buf = readFileSync(config.outfile);
    const gzipped = gzipSync(buf);
    const raw = statSync(config.outfile).size;
    const pct = ((gzipped.length / BUDGET_BYTES) * 100).toFixed(1);
    const status = gzipped.length <= BUDGET_BYTES ? "OK" : "OVER BUDGET";
    console.log(
      `[cart-block] bundle: ${raw}B raw, ${gzipped.length}B gzip (${pct}% of ${BUDGET_BYTES}B budget) — ${status}`
    );
    if (gzipped.length > BUDGET_BYTES && !watch) process.exitCode = 1;
  } catch (err) {
    console.warn("[cart-block] could not measure bundle size:", err.message);
  }
}

if (watch) {
  const ctx = await context({
    ...config,
    plugins: [
      {
        name: "size-report",
        setup(b) {
          b.onEnd(() => reportSize());
        },
      },
    ],
  });
  await ctx.watch();
  console.log("[cart-block] watching for changes…");
} else {
  await build(config);
  reportSize();
}
