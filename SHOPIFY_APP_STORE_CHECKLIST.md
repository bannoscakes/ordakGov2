# Shopify App Store Submission Checklist

**App Name:** ordakGov2
**Version:** 0.1.0
**Last Updated:** November 15, 2025

Use this checklist to ensure your app meets all Shopify App Store requirements before submission.

---

## ✅ COMPLETED - Critical Compliance

### GDPR Compliance (MANDATORY)
- [x] **CUSTOMERS_DATA_REQUEST webhook implemented** - Exports all customer data
- [x] **CUSTOMERS_REDACT webhook implemented** - Deletes customer personal data
- [x] **SHOP_REDACT webhook implemented** - Deletes all shop data after uninstall
- [x] **All compliance webhooks registered** in `app/shopify.server.ts`
- [x] **Privacy policy created** - See `PRIVACY_POLICY.md`

### Security Fixes
- [x] **XSS vulnerabilities fixed** - All `innerHTML` replaced with safe DOM methods
- [x] **Input validation added** - Zod schemas for API endpoints
- [x] **Environment validation** - All required env vars validated at startup
- [x] **Centralized logging** - All `console.error` replaced with logger

### Configuration
- [x] **App distribution set to AppStore** - `distribution: AppDistribution.AppStore`
- [x] **Webhook configuration complete** - All required webhooks registered
- [x] **OAuth scopes minimal** - Only necessary scopes requested

---

## ⚠️ TO DO BEFORE SUBMISSION

### 1. Privacy Policy & Legal (HIGH PRIORITY)

- [ ] **Update PRIVACY_POLICY.md with real contact information**
  - Current placeholders: `[support@ordakgov2.com]`, `[Your Business Address]`
  - Update email addresses in all sections
  - Add your actual business address
  - Add legal entity name

- [ ] **Create Terms of Service**
  - User agreement
  - Service level agreements
  - Liability limitations
  - Termination clauses

- [ ] **Create support email/system**
  - Set up support@ordakgov2.com (or similar)
  - Create support documentation/FAQ
  - Set up ticketing system (optional but recommended)

### 2. App Listing & Branding (HIGH PRIORITY)

- [ ] **Create app icon**
  - Size: 1200x1200 pixels
  - Format: JPEG or PNG
  - Guidelines: https://shopify.dev/docs/apps/launch/app-store-listing/app-icon
  - Must match app name and purpose
  - No Shopify branding/logos

- [ ] **Prepare app screenshots**
  - Minimum: 3-5 high-quality screenshots
  - Size: 1280x800 or 1920x1080 pixels
  - Show key features:
    1. Delivery/pickup time slot selection
    2. Postcode eligibility checker
    3. Admin settings panel
    4. Merchant dashboard
    5. Recommendations interface

- [ ] **Write app description**
  - Clear, concise explanation of what the app does
  - Key features and benefits
  - Target audience (merchants selling locally)
  - Value proposition

- [ ] **Create demo video (optional but recommended)**
  - 30-60 seconds
  - Show key workflows
  - Upload to YouTube or Vimeo

### 3. Technical Requirements (MEDIUM PRIORITY)

- [ ] **Install npm dependencies**
  ```bash
  npm install
  ```

- [ ] **Set up environment variables**
  - Copy `.env.example` to `.env`
  - Fill in all required values:
    - SHOPIFY_API_KEY
    - SHOPIFY_API_SECRET
    - SHOPIFY_APP_URL
    - DATABASE_URL
    - SCOPES

- [ ] **Run database migrations**
  ```bash
  npm run setup
  ```

- [ ] **Test build process**
  ```bash
  npm run build
  ```

- [ ] **Fix TypeScript errors** (if any)
  ```bash
  npm run type-check
  ```
  - Known issues in `app._index.tsx` and `app.orders._index.tsx`

- [ ] **Run linter and fix issues**
  ```bash
  npm run lint:fix
  npm run format
  ```

### 4. Performance Testing (MEDIUM PRIORITY)

- [ ] **Run Lighthouse tests**
  - Target metrics (Built for Shopify):
    - LCP ≤ 2000ms
    - CLS ≤ 0.1
    - INP ≤ 200ms
  - Test admin pages
  - Test embedded app pages

- [ ] **Test on development store**
  - Install app on test store
  - Complete setup wizard
  - Create test locations and zones
  - Test all customer-facing features:
    - Postcode eligibility check
    - Slot recommendation widget
    - Calendar display
    - Order scheduling
  - Test all merchant features:
    - Admin dashboard
    - Order management
    - Rescheduling
    - Settings configuration

- [ ] **Load testing**
  - Test with multiple concurrent users
  - Test with large number of slots
  - Monitor database performance

### 5. Security & Data Protection (HIGH PRIORITY)

- [ ] **Implement rate limiting**
  - Public API endpoints need protection:
    - `/api/eligibility/check`
    - `/api/recommendations/locations`
    - `/api/recommendations/slots`
  - Recommended: Use express-rate-limit or similar

- [ ] **Implement PII encryption at rest**
  - Customer emails
  - Customer phone numbers
  - Delivery addresses
  - Consider using field-level encryption

- [ ] **Security audit**
  - Review all API endpoints for vulnerabilities
  - Check authentication on protected routes
  - Verify webhook signature validation
  - Test CORS configuration

- [ ] **Dependency security check**
  ```bash
  npm audit
  npm audit fix
  ```

### 6. Testing & Quality Assurance (MEDIUM PRIORITY)

- [ ] **Create automated tests**
  - Unit tests for services
  - Integration tests for API endpoints
  - E2E tests for critical workflows
  - GDPR webhook tests

- [ ] **Manual testing checklist**
  - [ ] App installation
  - [ ] Setup wizard completion
  - [ ] Create location
  - [ ] Create delivery zone
  - [ ] Configure business rules
  - [ ] Customer postcode check
  - [ ] Slot selection
  - [ ] Order scheduling
  - [ ] Order rescheduling
  - [ ] Webhook delivery
  - [ ] App uninstallation
  - [ ] GDPR data request
  - [ ] GDPR data deletion

### 7. Documentation (MEDIUM PRIORITY)

- [ ] **Merchant setup guide**
  - Quick start guide
  - Step-by-step setup instructions
  - Common issues and troubleshooting
  - FAQs

- [ ] **Integration documentation**
  - External routing service integration
  - Webhook payload examples
  - API documentation

- [ ] **Update README.md**
  - Installation instructions
  - Configuration guide
  - Development setup
  - Deployment guide

### 8. App Store Listing Information

- [ ] **App name**
  - Unique and descriptive
  - Check availability in App Store
  - Should match `package.json` name

- [ ] **App tagline** (80 characters max)
  - One-sentence description
  - Example: "Smart delivery & pickup scheduling with AI-powered recommendations"

- [ ] **App categories**
  - Primary: Order management / Fulfillment
  - Secondary: Customer experience

- [ ] **Pricing information**
  - Determine pricing model (free, freemium, paid tiers)
  - Set up Shopify Billing API if charging
  - Create pricing page/documentation

- [ ] **Support URL**
  - Documentation site
  - Help center
  - Support portal

### 9. Shopify Partner Dashboard

- [ ] **App listing draft**
  - Login to Shopify Partners dashboard
  - Go to Apps > [Your App] > App listing
  - Fill in all required fields:
    - App name
    - Tagline
    - Description
    - Icon
    - Screenshots
    - Categories
    - Support URL
    - Privacy policy URL
    - Pricing

- [ ] **Review app permissions**
  - Verify scopes in `shopify.app.toml`
  - Ensure minimal necessary permissions
  - Document why each scope is needed

### 10. Pre-Submission Testing

- [ ] **Test app on multiple test stores**
  - Different Shopify plans
  - Different themes
  - Different locations/timezones

- [ ] **Cross-browser testing**
  - Chrome
  - Firefox
  - Safari
  - Edge

- [ ] **Mobile responsiveness**
  - Test on iOS
  - Test on Android
  - Test embedded app on mobile

- [ ] **Test all webhook scenarios**
  - App installation
  - App uninstallation
  - Order creation
  - GDPR requests

---

## 📋 RECOMMENDED IMPROVEMENTS (Not Blocking)

### Code Quality
- [ ] Replace console-based logger with production logging (Winston/Pino)
- [ ] Add comprehensive error handling to all async operations
- [ ] Implement data encryption for PII at rest
- [ ] Add database query optimization
- [ ] Implement caching for frequently accessed data

### Features
- [ ] Add analytics dashboard for merchants
- [ ] Implement email notifications
- [ ] Add multi-language support
- [ ] Create webhook retry mechanism
- [ ] Add backup/export functionality

### Performance
- [ ] Implement CDN for static assets
- [ ] Add database indexes for common queries
- [ ] Optimize bundle size
- [ ] Implement code splitting

---

## 📊 FINAL CHECKS BEFORE SUBMISSION

### Pre-Flight Checklist
- [ ] All critical items completed (see top section)
- [ ] Privacy policy updated with real contact info
- [ ] App icon created and uploaded
- [ ] Screenshots prepared and uploaded
- [ ] App description written
- [ ] Terms of service created
- [ ] Support system set up
- [ ] Tested on development store
- [ ] Lighthouse tests pass
- [ ] No TypeScript errors
- [ ] No security vulnerabilities (`npm audit`)
- [ ] All tests passing
- [ ] Documentation complete

### Submission Day
- [ ] Create backup of current codebase
- [ ] Verify production environment variables
- [ ] Double-check all URLs in app listing
- [ ] Submit app for review via Partner Dashboard
- [ ] Monitor email for App Review feedback
- [ ] Be prepared to respond to review feedback within 48 hours

---

## 📞 SUPPORT & RESOURCES

### Shopify Documentation
- [App requirements checklist](https://shopify.dev/docs/apps/launch/app-requirements-checklist)
- [App Store listing guidelines](https://shopify.dev/docs/apps/launch/app-store-listing)
- [Built for Shopify requirements](https://shopify.dev/docs/apps/launch/built-for-shopify)
- [GDPR compliance](https://shopify.dev/docs/apps/store/data-protection/gdpr)

### Tools
- [Lighthouse](https://developers.google.com/web/tools/lighthouse)
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli)
- [Polaris design system](https://polaris.shopify.com/)

### Contact
- Shopify Partner Support: https://help.shopify.com/partners
- App Review Team: Via Partner Dashboard

---

## 🎯 CURRENT STATUS

**Completion:** ~60%

**Blocking Issues:**
1. Privacy policy contact information
2. App icon creation
3. Screenshots preparation
4. Rate limiting implementation
5. PII encryption

**Estimated Time to Launch:** 1-2 weeks (with focused effort)

**Next Steps:**
1. Update privacy policy with real contact info
2. Design and create app icon
3. Take screenshots of key features
4. Implement rate limiting
5. Run comprehensive tests on development store

---

**Remember:** The Shopify App Review team typically responds within 3-5 business days. Be prepared to iterate based on their feedback.

Good luck with your submission! 🚀
