# WORKFLOW_SETUP (No Staging • No Mock Data)

## Branches
- `main` – production (tagged releases only)
- `dev` – integration (always deployable)
- `feature/*` – short-lived tasks

> No `staging` branch.

## Environments
- Local dev (Shopify CLI + tunnel)
- **Test Shopify Store** (only place we do end-to-end)
- Production (later, when listed)

### Rules
- No seeders/fixtures/mocks.
- Secrets only via env (local .env, CI secrets).
- Feature flags must work with real data.

## PR Flow
1. `feature/*` from `dev`
2. Conventional commits (`feat:`, `fix:`…)
3. PR → base=`dev`
4. Checks: build, lint, unit tests, bundle guard
5. Review: no mock data, least-priv OAuth, perf budget, uninstall cleanup
6. Squash merge

## Promote to `main`
- Verify on **Test store**
- PR `dev → main`, tag `vX.Y.Z`, release notes

## Testing Policy
- All E2E on **Test store** with real test orders by staff
- Remove test artifacts per tracker checklist

## “Not” List
- No staging env
- No mock orders/accounts/data
- No long-running branches
- No force-push on `dev`/`main`