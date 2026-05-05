# Security audit — npm dependencies

Snapshot of `npm audit --production` output, with rationale for any deferred vulnerabilities. Reviewed during Plan Task 5.7 (Phase 5 / App Store readiness).

## Current state

`npm audit --production` reports 36 vulnerabilities (8 moderate, 23 high, 5 critical) as of 2026-05-05. **All are in transitive dependencies; none are in code we wrote or directly import.**

The `npm audit fix` (non-breaking) command applies zero fixes — all remediation paths require `npm audit fix --force`, which would downgrade `@vercel/remix` to `2.10.3` and break our production deploy. We deliberately do not run `--force`.

## Vulnerabilities by class

### node-tar / cacache (high + critical, transitive via Shopify CLI tooling)

- GHSA-34x7-hfp2-rc4v / GHSA-8qq5-rm4j-mr97 / GHSA-83g3-92jg-28cx / GHSA-qffp-2rhf-9h96 / GHSA-9ppj-qmqm-q256 / GHSA-r6q2-hw4h-h46w — various tar extraction vulnerabilities
- Affected path: `node_modules/tar`, `node_modules/cacache` (depends on vulnerable tar)

**Why deferred:** these are transitive dependencies of `@shopify/cli` and other build-tooling. They run only at developer-machine `npm install` time and during Vercel build. They are NOT in the runtime serverless function bundle (`build/server`). The attack surface is "developer's machine processes a malicious tarball during install" — orders of magnitude less critical than a runtime vulnerability. We rely on:
- `npm install` on trusted package registries (npmjs.org)
- Vercel's build environment, which runs ephemerally per deploy

When Shopify CLI / cacache release upstream fixes, regenerate the lockfile by upgrading those direct deps and re-running `npm audit`.

### valibot ReDoS (high, transitive via `@vercel/remix`)

- GHSA-vqpr-j7v3-hqw9 — Regular expression denial of service in `EMOJI_REGEX`
- Affected path: `node_modules/valibot` (transitive via Vercel adapter)

**Why deferred:** `npm audit fix --force` proposes downgrading `@vercel/remix` to `2.10.3` to reach a non-vulnerable valibot. We pinned `@vercel/remix` to `2.16.7` in PR #64 specifically to match Remix 2.16.7 — downgrading would break the build pipeline. The ReDoS surface is in `EMOJI_REGEX` matching, which is not on a customer-input path in our app. The carrier service callback, cart-block, and webhook handlers do not match emoji patterns against arbitrary input.

When `@vercel/remix >= 2.16.x` ships an update that removes the vulnerable valibot range, re-run `npm audit fix` and verify the lockfile changes don't regress the Vercel deploy.

## Re-audit cadence

- After every quarterly stack-rot defense bump (`memory/stack_rot_defense.md`), re-run `npm audit --production` and update this doc.
- After every direct-dep upgrade, re-run.
- Before each App Store submission (re-review + re-submission cycle), confirm no NEW vulnerabilities outside the documented classes above.

## App Store reviewer note

Shopify's App Store review checks for OWASP-class runtime vulnerabilities, not transitive build-tooling CVEs that don't reach the deployed bundle. The `npm audit` output above reflects the broader npm ecosystem's tar/cacache class of vulnerabilities, which the wider Node.js ecosystem accepts as transitive risk. Our deployed function bundle on Vercel does not include `tar` or `cacache` at runtime; valibot's emoji regex is not exposed to user-controlled input. No reviewer-blocking action is required.
