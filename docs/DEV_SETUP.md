# DEV_SETUP.md

How to bring up Ordak Go locally and install it on the dev store. Follow the steps in order; do not improvise.

The Shopify CLI's `app dev` auto-orchestration **does not work** for this project — its auto-tunnel never starts, it never spawns Vite, and the `--tunnel-url` flag interprets the URL's port as a local-bind port (EACCES on `:443`). The manual 3-terminal flow below is the workable path.

## Prerequisites

- Node ≥ 20.10 (we use 22.22 via Volta)
- `npm install` already run (or do it now)
- Homebrew + `cloudflared` installed: `brew install cloudflared`
- macOS Keychain unlocked (mkcert may pop a password dialog; that's your Mac login password)
- `.env` file populated (Shopify creds, Supabase URL, session secret) — see end of this doc

## The 3 terminals

### Terminal 1 — Vite/Remix dev server
```
cd /Users/panospanayi/projects/ordakGov2
npm run vite:dev
```
Vite binds to `http://localhost:5173`. Wait for `➜ Local: http://localhost:5173/`.

### Terminal 2 — Cloudflare quick tunnel
```
cloudflared tunnel --url http://localhost:5173
```
Wait for the boxed output:
```
+----------------------------------------------------+
|  Your quick Tunnel has been created!               |
|  https://<random-words>.trycloudflare.com          |
+----------------------------------------------------+
```
**Copy that URL.** Keep this terminal open — closing it kills the tunnel.

> ⚠️ Quick tunnels are ephemeral. Every restart gets a new URL. For longer-lived dev work, set up a named cloudflared tunnel (deferred — see `docs/PLAN.md` Phase E).

### Terminal 3 — browser-side updates

1. **Update Partners**: P&T Group → Apps → Ordak Go → App setup → "Create new version"
   - **App URL**: `<the trycloudflare URL>`
   - **Allowed redirection URL(s)** (one per line):
     ```
     <tunnel>/auth/callback
     <tunnel>/auth/shopify/callback
     <tunnel>/api/auth/callback
     ```
   - Save (creates new active version, e.g. `ordak-go-3`)
2. **Update `.env`**:
   ```
   SHOPIFY_APP_URL=<the trycloudflare URL>
   ```
3. **Restart Vite** (Ctrl+C in Terminal 1, then `npm run vite:dev`) — needed to re-read `.env`.
4. **Open the app**: `https://admin.shopify.com/store/ordak-go-dev/apps/ordak-go`

If this is the first install for this Partners-app version, you'll see Shopify's OAuth grant dialog. Click Install. The embedded admin should load showing the Ordak Go dashboard.

## How to know it worked

In Terminal 1 (Vite), you should see log lines like:
```
[shopify-app/INFO] Handling OAuth callback request
[shopify-api/INFO] Creating new session
[shopify-app/INFO] Running afterAuth hook
[shopify-api/INFO] Registering webhooks
[shopify-app/INFO] Authenticating admin request
GET /app  →  200
```

Browser shows the embedded Polaris admin. Sidebar has "Ordak Go" with NavMenu items (Dashboard, Orders, Locations, Zones, Rules, Diagnostics, Settings).

## Failure modes seen in 2026-05 setup (and what they meant)

| Symptom | Real cause | Fix |
|---|---|---|
| `Shop is not configured for app development` | Store isn't a Partners-managed dev store | Create one: Partners → Stores → Add store → Development store |
| `These scopes are invalid` | Scope name format change | Use underscores, not hyphens (`write_merchant_managed_fulfillment_orders`) |
| `Unsupported section(s): web` | Newer CLI rejects `[web]` in toml | Remove that section |
| `EACCES: permission denied ::1:443` | `--tunnel-url ...:443` tries to bind locally on a privileged port | Don't use that flag; manual cloudflared instead |
| `Blocked request. This host (... .trycloudflare.com) is not allowed.` | Vite's `server.allowedHosts` blocking | Already handled in `vite.config.ts` (`.trycloudflare.com` whitelisted) |
| `Unknown argument refreshToken` | Schema missing the v9 session-storage columns | Already handled (migration applied) |
| Stuck on `/auth/callback` URL forever | Vite or cloudflared crashed | Check both terminals are still running |
| `oauth_error=same_site_cookies` / "issue with browser cookies" | Modern browsers block third-party cookies, breaking redirect OAuth | Already handled (`unstable_newEmbeddedAuthStrategy: true`) |
| OAuth loops indefinitely (CreateSession → Authenticating → CreateSession again) | Same as above | Same fix; if it persists, uninstall+reinstall the app to clear stale state |

## Restarting cloudflared

When you have to restart it (laptop sleep, network change, etc.):

1. Stop existing: Ctrl+C in Terminal 2
2. Start fresh: `cloudflared tunnel --url http://localhost:5173`
3. Note the **new** trycloudflare URL
4. Update Partners (new version with new URL + redirect URLs)
5. Update `SHOPIFY_APP_URL` in `.env`
6. Restart Vite

This is the friction that justifies a named tunnel for ongoing dev work.

## `.env` template

```
SHOPIFY_API_KEY=<from Partners → Ordak Go → Settings>
SHOPIFY_API_SECRET=<from Partners → Ordak Go → Settings>
SCOPES=write_products,write_orders,read_locations,write_merchant_managed_fulfillment_orders
SHOPIFY_APP_URL=<populated each session from cloudflared output>
DATABASE_URL=postgresql://postgres:<password>@db.zqwkqyviacvpjggesdbz.supabase.co:5432/postgres
SESSION_SECRET=<openssl rand -hex 32>
NODE_ENV=development
DEV_STORE_DOMAIN=ordak-go-dev.myshopify.com
```

If `@` appears in your DB password, URL-encode it as `%40` (otherwise the URL parser misreads the host).

## Database operations

Schema lives in `prisma/schema.prisma`; migrations in `prisma/migrations/`. Apply changes:

```
set -a && source .env && set +a && npx prisma migrate dev --name <description>
```

Sources `.env` to expose `DATABASE_URL` to Prisma (Prisma reads from process env, not from `.env` automatically when invoked via npx).

## Useful one-liners

```bash
# Type-check (must be 0 errors before commit)
npx tsc --noEmit

# Build (verifies production bundle compiles)
npm run build

# Test connection to Supabase (will say "database empty" if schema missing)
set -a && source .env && set +a && npx prisma db pull

# Open Prisma Studio against Supabase
set -a && source .env && set +a && npx prisma studio
```

## Don't waste time on

- `shopify app dev` (alone, no tunnel) — never updates Partners URL, app_home stays at example.com
- `shopify app dev --use-localhost` — generates cert but doesn't spawn Vite, doesn't update Partners URL
- `shopify app dev --tunnel-url <X>:443` — EACCES because flag's `:port` is a local-bind port, not the public one
- Trying to convert a non-Partners dev store (like `bannoscakes`) into one — it can't be done; create a fresh dev store

The 3-terminal flow above is the only thing that's been verified to work end-to-end.
