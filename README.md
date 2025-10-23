# ordakGov2 – Delivery & Pickup Scheduler App

Welcome to **ordakGov2**, a Shopify app that lets merchants provide their customers with flexible delivery and pickup options. This project is part of a build‑for‑Shopify initiative to create a streamlined local delivery experience while staying compliant with Shopify’s app guidelines.

## What this app does

- Allows shoppers to choose delivery or pickup on the product, cart, and drawer pages.
- Checks postcode eligibility and ensures customers are within defined delivery zones.
- Provides a calendar & time‑slot picker that respects cut‑offs, lead times, blackout dates, and capacity limits.
- Supports multiple locations with independent rules, and tags orders with selected date, slot, and location.
- Integrates with external routing services via signed webhooks for order scheduling and updates.
- Offers an admin setup wizard, calendar views, and rescheduling workflows for merchants.

## Documentation

The detailed design and process documentation lives in the [`docs`](docs) folder. Key documents include:

- `PRD.md` – Product Requirements Document.
- `FEATURES.md` – Feature specifications and scope.
- `DATA_MODEL.md` – Conceptual data model.
- `API_EVENTS.md` – API and event contract definitions.
- `CHECKOUT_SPEC.md` – Checkout & storefront extension spec.
- `SHOPIFY_COMPLIANCE.md` – App Store and Built for Shopify compliance checklist.
- `QA_TEST_PLAN.md` – End‑to‑end test matrix and quality plan.
- `SETUP_GUIDE.md` – Merchant setup instructions.
- Workflow docs in `docs/workflow` for contributor guidelines and project tracking.

## Development

This repository follows a **`main` / `Dev`** branch strategy. `main` contains the stable, production‑ready code; `Dev` is used for integration and daily work. A PR should be opened to merge changes from `Dev` into `main` after they have been tested on a Shopify test store.

Developers should review the documentation in `docs/` and `docs/workflow/` before contributing.

## Contributing

1. Fork the repository or create a new feature branch off `Dev`.
2. Follow the guidelines in `docs/workflow/WORKFLOW_SETUP.md` and `WORKFLOW_TRACKER.md`.
3. Submit a pull request with a clear description of your changes.

Please note: this app does not use mock data or a staging environment. All tests are performed against an official Shopify test store.

---

This README provides an entry point for developers and collaborators. See the documentation for full details and context.
