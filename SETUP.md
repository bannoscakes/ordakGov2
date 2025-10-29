# ordakGov2 Setup Instructions

This guide will help you set up the ordakGov2 Shopify app for development.

## Prerequisites

- Node.js 18.20+ or 20.10+ or 21+
- PostgreSQL 12+
- Shopify Partner account
- Shopify CLI (`npm install -g @shopify/cli @shopify/app`)

## Initial Setup

### 1. Clone and Install Dependencies

```bash
git clone <your-repo-url>
cd ordakGov2
npm install
```

### 2. Set Up PostgreSQL Database

Create a new PostgreSQL database:

```bash
createdb ordakgov2
```

### 3. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` and add:
- `SHOPIFY_API_KEY` - From your Shopify Partner dashboard
- `SHOPIFY_API_SECRET` - From your Shopify Partner dashboard
- `DATABASE_URL` - Your PostgreSQL connection string
- `SESSION_SECRET` - Generate a random string

### 4. Run Database Migrations

```bash
npx prisma migrate dev --name init
npx prisma generate
```

### 5. Link to Shopify App

```bash
npm run config:link
```

Follow the prompts to link to your Shopify Partner app.

### 6. Start Development Server

```bash
npm run dev
```

This will:
- Start the Remix dev server
- Create a tunnel using Shopify CLI
- Open your app in your development store

## Database Schema

The app uses the following main entities:

**Core Entities:**
- `Shop` - Merchant store settings
- `Location` - Pickup/delivery locations
- `Zone` - Delivery zones (postcode ranges, radius)
- `Rule` - Scheduling rules (cut-off times, lead times, blackout dates)
- `Slot` - Available time slots
- `OrderLink` - Links orders to scheduled slots

**Recommendation Entities:**
- `CustomerPreferences` - Historical customer preferences
- `RecommendationLog` - Audit log for recommendations

## Recommendation Engine Configuration

The recommendation engine can be configured per shop with these weights:
- `capacityWeight` - Prioritize slots with more availability (default: 0.4)
- `distanceWeight` - Prioritize closer locations (default: 0.3)
- `routeEfficiencyWeight` - Cluster deliveries geographically (default: 0.2)
- `personalizationWeight` - Match customer history (default: 0.1)

## Development Workflow

1. Create feature branches from `Dev`
2. Make changes and test on your development store
3. Create small PRs back to `Dev`
4. After testing, merge `Dev` to `main`

## Testing on Shopify Test Store

1. Install the app from Partner dashboard
2. Configure at least one location
3. Create delivery zones
4. Set up scheduling rules
5. Test the storefront widget
6. Place test orders and verify scheduling

## Useful Commands

```bash
# Generate Prisma client after schema changes
npx prisma generate

# Create a new migration
npx prisma migrate dev --name description_of_change

# View database in Prisma Studio
npx prisma studio

# Deploy to production
npm run deploy
```

## Troubleshooting

**Database connection errors:**
- Check your `DATABASE_URL` in `.env`
- Ensure PostgreSQL is running
- Verify database exists

**Shopify authentication issues:**
- Verify `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`
- Check that your app URL matches in Shopify Partner dashboard
- Ensure scopes are correct in `shopify.app.toml`

**Build errors:**
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check Node.js version: `node --version`

## Documentation

See the `docs/` folder for detailed documentation:
- `docs/app/PRD.md` - Product requirements
- `docs/app/RECOMMENDATIONS.md` - Recommendation engine spec
- `docs/app/DATA_MODEL.md` - Database model details
- `docs/app/API_EVENTS.md` - API contracts
- `docs/app/SETUP_GUIDE.md` - Merchant setup guide

## Support

For issues, check the GitHub repository issues page.
