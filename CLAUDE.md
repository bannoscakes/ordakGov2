# CLAUDE.md - AI Assistant Guide for ordakGov2

## Project Overview

**ordakGov2** is a production-ready Shopify embedded app that provides merchants with a sophisticated delivery and pickup scheduling system. The app features an AI-powered recommendation engine that suggests optimal time slots and locations to customers based on capacity, distance, route efficiency, and personalization.

**Project Type:** Shopify App (Embedded Admin + Storefront Extensions)
**Framework:** Remix 2.8.0 (Full-stack React framework with SSR)
**Database:** PostgreSQL with Prisma ORM
**Language:** TypeScript (strict mode)
**Architecture:** Multi-tenant SaaS with service layer pattern

---

## Technology Stack

### Core Framework
- **Remix 2.8.0** - Full-stack React framework with streaming SSR
- **React 18.2.0** - UI library
- **Vite 5.1.4** - Build tool and dev server
- **TypeScript 5.3.3** - Type-safe development (strict mode enabled)

### Shopify Integration
- `@shopify/shopify-app-remix` 2.8.0 - Core app framework
- `@shopify/shopify-api` 9.3.1 - REST/GraphQL API client
- `@shopify/app-bridge-react` 4.1.2 - Admin UI embedded features
- `@shopify/polaris` 12.28.0 - Shopify's design system

### Database & ORM
- **PostgreSQL 12+** - Primary database
- **Prisma 5.11.0** - Type-safe ORM and schema management
- `@shopify/shopify-app-session-storage-prisma` - Session storage adapter

### Development & Quality
- **Vitest** - Fast unit testing framework
- **ESLint** - Code linting (with Prettier integration)
- **Prettier** - Code formatting
- **Zod 3.22.4** - Runtime schema validation

### Node.js Requirements
- Node.js 18.20+ or 20.10+ or 21+

---

## Repository Structure

```
ordakGov2/
├── app/                          # Remix application root
│   ├── routes/                   # 27 route files (9,570+ LOC)
│   │   ├── _index.tsx           # Public auth entry (redirects to /app)
│   │   ├── auth.$.tsx           # OAuth callback handler
│   │   │
│   │   ├── [Admin Routes - /app prefix]
│   │   ├── app._index.tsx                    # Main dashboard
│   │   ├── app.setup.tsx                     # Setup wizard
│   │   ├── app.diagnostics.tsx               # Troubleshooting tool
│   │   ├── app.orders._index.tsx             # Orders list
│   │   ├── app.orders.$orderId.reschedule.tsx # Reschedule interface
│   │   │
│   │   ├── [Management Routes]
│   │   ├── app.locations._index.tsx          # CRUD for locations
│   │   ├── app.locations.$id.tsx
│   │   ├── app.zones._index.tsx              # CRUD for delivery zones
│   │   ├── app.zones.$id.tsx
│   │   ├── app.rules._index.tsx              # CRUD for business rules
│   │   ├── app.rules.$id.tsx
│   │   ├── app.settings.recommendations.tsx   # Algorithm weights config
│   │   │
│   │   ├── [Public API Routes - Customer Facing]
│   │   ├── api.recommendations.slots.tsx      # Slot recommendation engine
│   │   ├── api.recommendations.locations.tsx  # Location recommendations
│   │   ├── api.eligibility.check.tsx          # Postcode validation
│   │   ├── api.reschedule.tsx                 # Customer self-service
│   │   ├── api.orders.tag.tsx                 # Order tagging
│   │   ├── api.events.recommendation-*.tsx    # Analytics tracking
│   │   │
│   │   └── [Webhooks]
│   │       ├── webhooks.tsx                   # GDPR & app lifecycle
│   │       └── webhooks.orders.create.tsx     # New order processing
│   │
│   ├── services/                 # Business logic layer
│   │   ├── recommendation.service.ts  # Core scoring algorithm
│   │   ├── recommendation.types.ts    # Type definitions
│   │   ├── distance.service.ts        # Haversine distance calculations
│   │   ├── metafield.service.ts       # Shopify metafield utilities
│   │   ├── index.ts                   # Service exports (barrel file)
│   │   └── README.md                  # Algorithm documentation
│   │
│   ├── utils/                    # Server-only utilities
│   │   ├── env.server.ts         # Environment validation
│   │   ├── logger.server.ts      # Centralized logging
│   │   └── validation.server.ts  # Input validation helpers
│   │
│   ├── entry.server.tsx          # Remix SSR entry point
│   ├── entry.client.tsx          # Remix client hydration
│   ├── root.tsx                  # Root React component (HTML shell)
│   ├── db.server.ts              # Prisma singleton
│   └── shopify.server.ts         # Shopify API initialization
│
├── prisma/
│   ├── schema.prisma             # Database schema (10 models)
│   └── migrations/               # Migration history
│
├── public/                       # Static assets & client-side widgets
│   ├── ordak-widget.js/.css      # Main scheduling widget
│   ├── postcode-checker.js/.css  # Eligibility checker
│   ├── fulfillment-toggle.js/.css # Delivery/pickup toggle
│   └── *INSTALLATION_GUIDE.md    # Widget installation docs
│
├── test/                         # Test files
│   ├── setup.ts                  # Vitest configuration
│   └── example.test.ts           # Example tests
│
├── docs/                         # Documentation
│   ├── app/                      # Feature documentation
│   │   ├── FEATURES.md           # Feature list
│   │   ├── API_EVENTS.md         # API contracts
│   │   ├── DATA_MODEL.md         # Database schema details
│   │   ├── RECOMMENDATIONS.md    # Algorithm specification
│   │   ├── SHOPIFY_COMPLIANCE.md # GDPR & compliance
│   │   ├── QA_TEST_PLAN.md       # Testing procedures
│   │   └── SETUP_GUIDE.md        # Merchant setup
│   └── workflow/                 # Development workflow
│       ├── WORKFLOW_SETUP.md     # Dev environment setup
│       └── WORKFLOW_TRACKER.md   # Progress tracking
│
└── Configuration Files
    ├── package.json              # Dependencies & scripts
    ├── tsconfig.json             # TypeScript config (strict mode)
    ├── vite.config.ts            # Vite build config
    ├── vitest.config.ts          # Test framework config
    ├── remix.config.js           # Remix framework config
    ├── shopify.app.toml          # Shopify app configuration
    ├── .eslintrc.js              # ESLint rules
    └── prettier.config.js        # Code formatting rules
```

---

## Database Schema Overview

**Location:** `/home/user/ordakGov2/prisma/schema.prisma`
**Database:** PostgreSQL
**Total Models:** 10

### Core Entities

1. **Session** - Shopify OAuth session storage
   - Supports both online and offline tokens
   - Stores merchant user data

2. **Shop** - Multi-tenant merchant configuration
   - `shopifyDomain` - Unique shop identifier
   - Recommendation algorithm weights (configurable):
     - `capacityWeight` (default: 0.4)
     - `distanceWeight` (default: 0.3)
     - `routeEfficiencyWeight` (default: 0.2)
     - `personalizationWeight` (default: 0.1)
   - All data is scoped to shop (tenant isolation)

3. **Location** - Fulfillment centers / pickup points
   - Address, coordinates (lat/long)
   - Timezone configuration
   - Support flags: `supportsDelivery`, `supportsPickup`

4. **Zone** - Delivery coverage areas
   - Types: `postcode_range`, `postcode_list`, `radius`
   - Priority-based ordering
   - Linked to locations

5. **Rule** - Business constraints
   - Types: `cutoff`, `lead_time`, `blackout`, `capacity`
   - Slot duration and capacity limits
   - Blackout dates for holidays

6. **Slot** - Available time windows
   - Date, start/end times
   - Capacity and booking count
   - Recommendation score (calculated)
   - Fulfillment type (delivery/pickup)

7. **OrderLink** - Customer order scheduling
   - Maps Shopify orders to slots
   - Status: `scheduled`, `updated`, `canceled`, `completed`
   - Stores delivery address and postcode
   - Recommendation metadata

8. **EventLog** - Audit trail for analytics
   - Event types: `order.scheduled`, `recommendation.viewed`, etc.
   - JSON payload storage
   - Timestamps for analytics dashboard

9. **CustomerPreferences** - Personalization data
   - Historical preferences (days, times, locations)
   - Order statistics for recommendation engine

10. **RecommendationLog** - Analytics tracking
    - Session tracking
    - Recommended vs. selected slots
    - A/B testing data

### Key Database Patterns
- **Cascade Deletes:** All shop-related data cascades on shop deletion
- **Indexed Fields:** Foreign keys, dates, timestamps, shopId
- **Timestamps:** All entities have `createdAt` and `updatedAt`

---

## Key Architectural Patterns

### 1. Remix Full-Stack Pattern
- **Loaders** - Server-side data fetching for GET requests
- **Actions** - Server-side mutations for POST/PUT/DELETE
- **Progressive Enhancement** - Works without JavaScript
- **Streaming SSR** - Fast initial page loads

### 2. Server-Only Code Convention
Files ending with `.server.ts` are **never** bundled to the client:
- `app/db.server.ts` - Prisma singleton
- `app/shopify.server.ts` - Shopify API client
- `app/utils/*.server.ts` - Server utilities

### 3. Service Layer Architecture
Business logic lives in `app/services/`:
- Type-safe interfaces in `.types.ts` files
- Exported through `index.ts` barrel file
- Pure functions that can be tested independently
- Example: `scoreSlots()`, `calculateDistance()`

### 4. Multi-Tenant SaaS Pattern
- Every request is scoped to a `shopifyDomain`
- Shop model contains tenant-specific configuration
- Session storage maps sessions to shops
- All database queries filter by `shopId`

### 5. Shopify Authentication Patterns

**Admin Routes (`/app/*`):**
```typescript
const { admin, session } = await authenticate.admin(request);
// Access Shopify Admin API and merchant session
```

**Public API Routes (`/api/*`):**
```typescript
const { shop } = await authenticate.public.appProxy(request);
// Access shop context from customer-facing requests
```

**Webhooks:**
```typescript
const { topic, shop, payload } = await authenticate.webhook(request);
// Process GDPR and order webhooks
```

### 6. Recommendation Engine Pattern
Located in `app/services/recommendation.service.ts`:

**Algorithm:** Weighted scoring system
- **Capacity Score** (40%): Prefers slots with more availability
- **Distance Score** (30%): Prefers closer locations (Haversine formula)
- **Route Efficiency** (20%): Clusters deliveries geographically
- **Personalization** (10%): Matches customer history

**Output:** Ranked list with scores and human-readable reasons

---

## Code Conventions

### File Naming
- **Routes:** Remix flat-file routing with dots
  - `app._index.tsx` → `/app`
  - `app.locations.$id.tsx` → `/app/locations/:id`
  - `api.recommendations.slots.tsx` → `/api/recommendations/slots`
- **Server-only:** `*.server.ts` suffix
- **Types:** `*.types.ts` for shared type definitions

### TypeScript Path Aliases
- `~/*` → `./app/*` (configured in tsconfig.json)
- Example: `import { db } from "~/db.server";`

### Import Order
1. External dependencies
2. Shopify packages
3. Internal utilities (`~/utils/*`)
4. Services (`~/services`)
5. Database (`~/db.server`)

### Error Handling
- Use centralized logger from `~/utils/logger.server.ts`
- Return proper HTTP status codes (400, 404, 500)
- Structured error responses:
  ```typescript
  return json({ error: "Message", details: {} }, { status: 400 });
  ```

### Validation
- Use Zod for runtime validation
- Validate all user inputs
- Validate environment variables at startup

### Logging
```typescript
import { logger } from "~/utils/logger.server";

logger.info("Operation completed", { context: "value" });
logger.error("Operation failed", { error: err });
```

---

## Development Workflow

### Branch Strategy
- **`main`** - Production-ready code (tagged releases only)
- **`Dev`** - Integration branch (always deployable)
- **`feature/*`** - Short-lived task branches

**No staging environment - all testing on real Shopify test store**

### Commit Convention
Use conventional commits:
- `feat:` - New features
- `fix:` - Bug fixes
- `refactor:` - Code refactoring
- `docs:` - Documentation changes
- `test:` - Test additions/changes

### PR Workflow
1. Create `feature/*` branch from `Dev`
2. Make changes and test locally
3. Open PR to `Dev` (not `main`)
4. PR checks:
   - Build succeeds
   - Linting passes
   - Type checking passes
   - Unit tests pass
5. Squash merge to `Dev`
6. Test on Shopify test store
7. When stable, PR `Dev` → `main` with version tag

### No Mock Data Policy
- **Never use mock data or fixtures**
- All testing on real Shopify test store
- No staging environment
- Feature flags must work with real data

---

## Common Development Tasks

### 1. Adding a New API Route

**Location:** `app/routes/api.*.tsx`

**Template:**
```typescript
import { json } from "@remix-run/node";
import type { ActionFunction } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { logger } from "~/utils/logger.server";

export const action: ActionFunction = async ({ request }) => {
  try {
    const { shop } = await authenticate.public.appProxy(request);

    // Parse and validate request
    const formData = await request.formData();
    const param = formData.get("param");

    // Query database scoped to shop
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop },
    });

    if (!shopRecord) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    // Business logic here

    return json({ success: true, data: {} });
  } catch (error) {
    logger.error("API error", { error, route: request.url });
    return json({ error: "Internal error" }, { status: 500 });
  }
};
```

### 2. Adding a New Admin Route

**Location:** `app/routes/app.*.tsx`

**Template:**
```typescript
import type { LoaderFunction, ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";

export const loader: LoaderFunction = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Fetch data
  const data = await db.entity.findMany({
    where: { shopId: shop.id },
  });

  return json({ data });
};

export const action: ActionFunction = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  // Handle mutations

  return json({ success: true });
};

export default function Component() {
  const { data } = useLoaderData<typeof loader>();

  return (
    <Page title="Title">
      {/* Polaris components */}
    </Page>
  );
}
```

### 3. Adding a Database Model

**Steps:**
1. Edit `prisma/schema.prisma`
2. Add the new model with proper relations
3. Always include `createdAt` and `updatedAt`
4. Add indexes for frequently queried fields
5. Run migration:
   ```bash
   npx prisma migrate dev --name add_model_name
   npx prisma generate
   ```

### 4. Modifying the Recommendation Algorithm

**File:** `app/services/recommendation.service.ts`

**Key Functions:**
- `scoreSlots()` - Main scoring logic
- `calculateCapacityScore()` - Availability scoring
- `calculateDistanceScore()` - Geographic scoring
- `calculateRouteEfficiencyScore()` - Clustering logic
- `calculatePersonalizationScore()` - Customer preferences

**Testing:** Update weights in Shop model to test different configurations

### 5. Adding a Webhook Handler

**File:** `app/routes/webhooks.tsx` or create new route

**Important:**
- Register webhook in Shopify Partner dashboard
- Use `authenticate.webhook(request)`
- Handle GDPR webhooks: `CUSTOMERS_DATA_REQUEST`, `CUSTOMERS_REDACT`, `SHOP_REDACT`
- Always respond quickly (within 5 seconds)

---

## OAuth Scopes

**File:** `shopify.app.toml`

**Current Scopes:**
- `write_products` - Product data access
- `write_orders` - Order management and tagging
- `read_locations` - Store location data
- `write_merchant-managed_fulfillment_orders` - Fulfillment management

**Important:** Request minimal scopes needed. Adding new scopes requires merchant re-authentication.

---

## Environment Variables

**File:** `.env` (not committed to git)

**Required Variables:**
- `SHOPIFY_API_KEY` - From Shopify Partner dashboard
- `SHOPIFY_API_SECRET` - From Shopify Partner dashboard
- `DATABASE_URL` - PostgreSQL connection string (format: `postgresql://user:pass@host:port/dbname`)
- `SESSION_SECRET` - Random string for session encryption
- `SHOPIFY_APP_URL` - Auto-generated by Shopify CLI (tunnel URL)

**Validation:** Environment is validated at startup via `getEnv()` in `app/utils/env.server.ts`

---

## Testing

### Unit Tests
**Framework:** Vitest
**Location:** `test/*.test.ts`
**Configuration:** `vitest.config.ts`

**Run Tests:**
```bash
npm test                 # Run once
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report
```

### E2E Testing
**No automated E2E** - all testing on real Shopify test store by staff

**Test Checklist:** See `docs/app/QA_TEST_PLAN.md` and `TESTING_GUIDE.md`

### Type Checking
```bash
npm run type-check  # TypeScript validation
```

### Linting & Formatting
```bash
npm run lint        # Check for issues
npm run lint:fix    # Auto-fix issues
npm run format      # Format all files
npm run format:check # Check formatting
```

---

## Important Files for AI Assistants

### Must-Read Documentation
1. **README.md** - Project overview and entry point
2. **docs/app/FEATURES.md** - Feature list and MVP scope
3. **docs/app/RECOMMENDATIONS.md** - Recommendation algorithm details
4. **docs/app/DATA_MODEL.md** - Database schema documentation
5. **docs/workflow/WORKFLOW_SETUP.md** - Development workflow
6. **app/services/README.md** - Recommendation engine documentation

### Key Configuration Files
1. **prisma/schema.prisma** - Database schema (10 models)
2. **shopify.app.toml** - Shopify app configuration
3. **tsconfig.json** - TypeScript configuration
4. **package.json** - Dependencies and scripts

### Entry Points
1. **app/shopify.server.ts** - Shopify API initialization
2. **app/db.server.ts** - Database client
3. **app/routes/_index.tsx** - Public entry point
4. **app/routes/app._index.tsx** - Admin dashboard

---

## Common Pitfalls & Best Practices

### ❌ Common Mistakes

1. **Forgetting tenant isolation**
   ```typescript
   // BAD - queries all shops
   const locations = await db.location.findMany();

   // GOOD - scoped to shop
   const locations = await db.location.findMany({
     where: { shopId: shop.id },
   });
   ```

2. **Using client-side code in .server.ts files**
   - Server files should never import client-only code
   - Use proper `*.server.ts` suffix

3. **Not validating user input**
   ```typescript
   // BAD - no validation
   const postcode = formData.get("postcode");

   // GOOD - validated with Zod
   const schema = z.object({ postcode: z.string().min(1) });
   const { postcode } = schema.parse(Object.fromEntries(formData));
   ```

4. **Hardcoding weights instead of using Shop configuration**
   ```typescript
   // BAD - hardcoded
   const score = capacityScore * 0.4;

   // GOOD - from shop settings
   const score = capacityScore * shop.capacityWeight;
   ```

5. **Not handling webhook timeouts**
   - Webhooks must respond within 5 seconds
   - Queue long-running tasks, respond immediately

### ✅ Best Practices

1. **Always scope queries to shop**
   ```typescript
   where: { shopId: shop.id }
   ```

2. **Use the logger for debugging**
   ```typescript
   logger.info("Context message", { data: value });
   ```

3. **Return proper HTTP status codes**
   - 200: Success
   - 400: Bad request (validation error)
   - 404: Not found
   - 500: Internal server error

4. **Use TypeScript types from Prisma**
   ```typescript
   import type { Shop, Location } from "@prisma/client";
   ```

5. **Test on real Shopify store**
   - No mock data
   - Real orders, real metafields
   - Clean up test data per tracker

6. **Follow the service layer pattern**
   - Keep business logic in `app/services/`
   - Routes should be thin controllers
   - Services should be pure, testable functions

7. **Use Polaris components**
   - Shopify design system for admin UI
   - Consistent with Shopify admin experience
   - Accessible by default

8. **Handle cascade deletes**
   - When shop is deleted, all data cascades
   - Prisma handles this via `onDelete: Cascade`

---

## Storefront Widgets

**Location:** `public/*.js` and `public/*.css`

**Purpose:** Customer-facing UI embedded in Shopify themes

**Widgets:**
1. **ordak-widget.js** - Main scheduling calendar
2. **postcode-checker.js** - Eligibility validator
3. **fulfillment-toggle.js** - Delivery/pickup switcher

**Installation:** Merchants install via theme liquid templates (see `public/*INSTALLATION_GUIDE.md`)

**API Integration:** Widgets call `/api/*` endpoints

---

## GDPR & Compliance

**Location:** `app/routes/webhooks.tsx`

**Required Webhooks:**
1. **APP_UNINSTALLED** - Clean up shop data immediately
2. **CUSTOMERS_DATA_REQUEST** - Export customer data (GDPR)
3. **CUSTOMERS_REDACT** - Delete customer data (GDPR)
4. **SHOP_REDACT** - Delete all shop data 48h after uninstall

**Documentation:** `docs/app/SHOPIFY_COMPLIANCE.md`

**Important:** These webhooks are required for Shopify App Store approval

---

## Debugging Tips

### Check Shopify CLI Logs
```bash
npm run dev  # Watch terminal for errors
```

### View Database in Prisma Studio
```bash
npx prisma studio
```

### Check Database State
```bash
psql $DATABASE_URL
\dt  # List tables
SELECT * FROM "Shop";
```

### View Real-Time Logs
```typescript
import { logger } from "~/utils/logger.server";
logger.debug("Debug info", { context });
```

### Test API Endpoints
```bash
curl -X POST http://localhost:8002/api/recommendations/slots \
  -H "Content-Type: application/json" \
  -d '{"shop": "test.myshopify.com", "postcode": "SW1A 1AA"}'
```

---

## Performance Considerations

1. **Database Queries**
   - Use `include` for relations, not separate queries
   - Index frequently queried fields
   - Limit result sets with pagination

2. **Recommendation Algorithm**
   - Cache shop settings
   - Batch database queries
   - Consider implementing query result caching

3. **Remix Loaders**
   - Loaders run on every page load
   - Keep queries fast
   - Use `defer()` for slow queries

4. **Webhook Processing**
   - Respond within 5 seconds
   - Queue long-running tasks
   - Log errors for debugging

---

## Security Considerations

1. **Input Validation**
   - Validate all user inputs with Zod
   - Sanitize SQL inputs (Prisma handles this)
   - Validate webhook signatures

2. **Authentication**
   - All admin routes require `authenticate.admin()`
   - Public API uses `authenticate.public.appProxy()`
   - Session storage in secure Prisma adapter

3. **Secrets Management**
   - Never commit `.env` file
   - Use environment variables for all secrets
   - Rotate `SESSION_SECRET` regularly

4. **Data Access**
   - Always scope queries to `shopId`
   - Validate user has access to requested resources
   - Use Prisma's type-safe queries

---

## Deployment

**Development:**
```bash
npm run dev  # Shopify CLI with tunnel
```

**Production:**
```bash
npm run build   # Build Remix app
npm run deploy  # Deploy via Shopify CLI
```

**Docker:**
```bash
npm run docker-start  # Runs migrations + starts server
```

**Environment:** See `SETUP.md` for production deployment guide

---

## Quick Reference Commands

```bash
# Development
npm run dev                 # Start dev server with Shopify CLI
npm run build              # Build for production
npm run start              # Start production server

# Database
npx prisma migrate dev     # Create and apply migration
npx prisma migrate deploy  # Apply migrations (production)
npx prisma generate        # Generate Prisma client
npx prisma studio          # Database GUI

# Code Quality
npm run lint               # Check linting
npm run lint:fix           # Fix linting issues
npm run format             # Format all files
npm run type-check         # TypeScript validation

# Testing
npm test                   # Run unit tests
npm run test:watch         # Watch mode
npm run test:coverage      # With coverage

# Shopify CLI
npm run config:link        # Link to Shopify app
npm run deploy             # Deploy to Shopify
npm run shopify            # Run Shopify CLI commands
```

---

## Key Concepts for AI Assistants

### When Working on This Codebase

1. **Multi-Tenancy is Critical**
   - Every query must be scoped to a shop
   - Shop data must never leak between tenants
   - Always use `shopId` in where clauses

2. **No Mock Data Policy**
   - Test on real Shopify store
   - No fixtures, no seed data
   - Feature flags work with real data

3. **Recommendation Engine is Core Value**
   - Located in `app/services/recommendation.service.ts`
   - Configurable weights per shop
   - Algorithm is well-documented in `app/services/README.md`

4. **Shopify Compliance Required**
   - GDPR webhooks must work
   - OAuth scopes must be minimal
   - App Store guidelines must be followed

5. **TypeScript Strict Mode**
   - All code is type-checked
   - Prisma types are authoritative
   - Use `type` imports for type-only imports

6. **Server/Client Separation**
   - `.server.ts` files never sent to client
   - Remix handles this automatically
   - Don't import server code in client components

7. **Remix Conventions**
   - Loaders for GET (data fetching)
   - Actions for POST/PUT/DELETE (mutations)
   - Progressive enhancement philosophy

8. **Documentation is Comprehensive**
   - Check `docs/` before asking questions
   - README.md files in subdirectories
   - Inline code comments for complex logic

### When Adding Features

1. Check `docs/app/FEATURES.md` for scope
2. Update database schema if needed (Prisma migration)
3. Add service layer logic (`app/services/`)
4. Create route handlers (`app/routes/`)
5. Update documentation
6. Test on real Shopify store
7. Follow PR workflow (feature → Dev → main)

### When Debugging Issues

1. Check Shopify CLI logs in terminal
2. Check browser console (for admin UI)
3. Check Prisma Studio for database state
4. Check `logger` output
5. Review recent commits for changes
6. Test on fresh Shopify store if needed

---

## Related Documentation

- **Product Requirements:** `docs/app/PRD.md`
- **API Contracts:** `docs/app/API_EVENTS.md`
- **Testing Plan:** `docs/app/QA_TEST_PLAN.md`
- **Setup Guide:** `SETUP.md`
- **Testing Guide:** `TESTING_GUIDE.md`
- **Workflow Setup:** `docs/workflow/WORKFLOW_SETUP.md`
- **Compliance:** `docs/app/SHOPIFY_COMPLIANCE.md`

---

## Contact & Support

- **GitHub Issues:** For bug reports and feature requests
- **Documentation:** Check `docs/` folder for detailed guides
- **Shopify Partner:** For platform-specific questions

---

**Last Updated:** 2025-11-17
**Codebase Version:** Based on commit 1160332
**Total Lines of Code:** ~9,570 LOC in routes + services + utils
**Database Models:** 10 models in Prisma schema

---

## AI Assistant Instructions Summary

When working with this codebase:

✅ **DO:**
- Always scope database queries to `shopId`
- Use TypeScript strict mode types
- Follow Remix patterns (loader/action)
- Test on real Shopify store
- Use the service layer for business logic
- Validate all inputs with Zod
- Use centralized logger
- Follow conventional commit messages
- Check existing documentation first
- Use Polaris components for admin UI

❌ **DON'T:**
- Use mock data or fixtures
- Skip tenant isolation checks
- Hardcode configuration values
- Import server code in client components
- Skip input validation
- Force-push to main/Dev branches
- Add unnecessary OAuth scopes
- Commit secrets to git
- Create long-running branches
- Skip testing on real Shopify store

**When in doubt, check the documentation in `docs/` or ask specific questions about the architecture.**
