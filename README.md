# Returns & Exchanges — Shopify App

A native Shopify app for return/exchange management, modeled on **Return Prime**
and **QuickReturns**: branded self-serve return portal → automation rules
engine → refund/exchange/store-credit flows → analytics.

Built on Shopify's standard app stack (the same one nearly every modern
Shopify app, including the two above, is built on):

- **Remix** (Node.js, React, SSR) — Shopify's official app framework
- **Shopify Polaris** — admin UI components
- **Prisma + Postgres** (Neon or Supabase in production; SQLite for pure local dev) — data + session storage
- **Vercel** — hosting, via the `@vercel/remix` build preset
- **Shopify Admin GraphQL API** — orders, products, variants
- **App Proxy** — exposes a storefront-facing return portal without a
  separate auth system

## Automations shipped

1. **Auto-suggest Exchange instead of Refund** (returns)
2. **Auto-approve Order Cancellation** (pre-fulfillment, self-serve)
3. **RTO (Return to Origin) auto-resolve** (courier-initiated, kept separate from customer returns)
4. **Manual Replacement / Warranty Order Booking** (free $0 orders for marketplace, offline, and warranty claims)

---

### 1. "Auto-suggest Exchange instead of Refund"

This is the retention-focused automation you asked to build first.

**Flow:**
1. Customer opens a return in the portal → `POST /apps/returns/submit`
   (`app/routes/proxy.returns.tsx`)
2. The engine (`app/models/automation.server.ts`) checks the shop's active
   `AutomationRule`s (configured in **Automation Rules** in the admin —
   `app/routes/app.settings.tsx`) against the return's reason, order value,
   product tags, and return window.
3. If a `SUGGEST_EXCHANGE` rule matches, it calls the Admin API
   (`app/models/admin-catalog.server.ts`) to find:
   - other variants of the *same* product first (e.g. a size swap), or
   - related products from the same collection as a fallback
4. The customer is shown these exchange options **before** the refund
   button, optionally sweetened with extra store-credit % (the incentive).
5. Customer accepts (`POST /apps/returns/decision` → exchange) or declines
   (falls through to the normal refund flow).

**Why this shape:** it mirrors exactly how Return Prime and QuickReturns
structure their "smart exchange" / "retention" features — rule-based,
merchant-configurable, no code changes needed to tune which reasons trigger
suggestions or how big the incentive is.

### 2. "Auto-approve Order Cancellation"

QuickReturns (and standalone apps like "WF - Order Cancellation") let
customers self-cancel from the order-status/thank-you page **before** the
order ships — distinct from a post-delivery return.

**Flow:**
1. Customer requests cancellation → `POST /apps/returns/cancel-order`
   (`app/routes/proxy.cancel-order.tsx`)
2. `app/models/cancellation.server.ts` checks the shop's
   `CANCELLATION_AUTO_APPROVE` rule: is the order still unfulfilled, and is
   the request within the configured cutoff window (e.g. 6 hours after the
   order was placed)?
3. If both hold → `AUTO_APPROVED` immediately. Otherwise it's routed to
   **Cancellations** in the admin (`app/routes/app.cancellations.tsx`) for
   a human decision — never silently rejected.
4. `webhooks.orders.cancelled.tsx` syncs the request to `COMPLETED` once
   Shopify confirms the order is actually cancelled.

### 3. "RTO (Return to Origin) auto-resolve"

Modeled on QuickReturns' explicit RTO support and how carrier platforms
(Eshopbox, Shiprocket, etc.) handle it: **RTO is kept as its own status
track, never merged into customer-initiated returns** — a distinction
merchants specifically ask Shopify for.

**Flow:**
1. A courier reports a failed delivery attempt (bad address, out of
   delivery area, customer unavailable/refused, COD payment refused, or a
   last-minute cancellation) → `webhooks.fulfillment_events.create.tsx`
   flags an `RTOShipment` (`app/models/rto.server.ts`).
2. Status progresses `FLAGGED` → `IN_TRANSIT` → `RECEIVED_AT_ORIGIN`
   (marked from the admin **RTO** tab, or by a WMS integration, once the
   parcel is physically back).
3. On receipt, if an active `RTO_AUTO_ACTION` rule matches the RTO reason,
   it auto-resolves: restock inventory, refund the customer, flag for
   reshipment, or route to manual review (useful for COD orders where a
   human should verify before refunding).
4. Everything is visible in **RTO** (`app/routes/app.rto.tsx`) with reason,
   carrier/tracking, COD amount owed, and resolution status.

### 4. "Manual Replacement / Warranty Order Booking"

The gap the other three automations don't cover: damage or defect claims
that never touch a Shopify order at all — a product bought on a
**marketplace** (Amazon, Flipkart, ...) arrived damaged, an **offline/
in-store** purchase was defective, or a standing **warranty claim** comes
in with no order reference. Staff book these directly inside the app
(`app/routes/app.replacements.tsx`) — "book it from this platform only."

**Flow:**
1. Staff fills in source (marketplace/offline/warranty/Shopify order),
   damage type, marketplace name or invoice ref, customer + shipping
   details, and the item(s) to send — free of charge.
2. `app/models/replacement.server.ts` records it and checks the shop's
   `REPLACEMENT_AUTO_APPROVE` rule: bookings at or under a configured
   value threshold are approved immediately; anything above it sits at
   `PENDING_REVIEW` for a manager to approve.
3. Once `APPROVED`, staff click **Create $0 order** →
   `app/models/admin-orders.server.ts` creates a Shopify draft order with
   a 100%-off discount on every line (so the retail value is preserved for
   reporting, but the customer owes nothing), completes it into a real
   order, and it flows through normal fulfillment — packing slip,
   shipping label, tracking — like any other order.
4. Status: `PENDING_REVIEW → APPROVED → ORDER_CREATED → FULFILLED` (or
   `REJECTED`).

**Not yet built:** a real product/variant picker (currently a manual
variant-GID text field — functional but not friendly), and a customer-
facing claim submission form (right now it's staff-only, matching "book it
from this platform" — a public claim form is a natural next step if you
want customers submitting these themselves).

## Project layout

```
app/
  shopify.server.ts          Shopify auth/session bootstrap
  db.server.ts                Prisma client singleton
  models/
    automation.server.ts      Exchange-suggestion rule engine
    admin-catalog.server.ts   Admin API calls (variants, related products)
    cancellation.server.ts    Cancellation cutoff/eligibility engine
    rto.server.ts              RTO flagging + auto-resolve engine
    replacement.server.ts      Replacement/warranty booking + value-threshold approval
    admin-orders.server.ts     Admin API: create + complete a $0 draft order
  routes/
    app._index.tsx             Merchant dashboard (KPIs across all 4 automations)
    app.settings.tsx           Configure all 4 automation rules
    app.returns.tsx             Return requests + outcomes
    app.cancellations.tsx       Pending/decided cancellation requests
    app.rto.tsx                 RTO shipments + mark-received action
    app.replacements.tsx        Book + manage free replacement/warranty orders
    proxy.returns.tsx           Storefront: submit a return, run automation
    proxy.returns.decision.tsx  Storefront: accept/decline suggested exchange
    proxy.cancel-order.tsx      Storefront: request order cancellation
    webhooks.fulfillment_events.create.tsx  Detects courier delivery failure → flags RTO
    webhooks.orders.cancelled.tsx           Syncs CancellationRequest → COMPLETED
    webhooks.app.uninstalled.tsx
prisma/schema.prisma    Shop, AutomationRule, ReturnRequest, ReturnLineItem,
                         CancellationRequest, RTOShipment, ReplacementOrder,
                         ReplacementLineItem
```

## Not yet built (next in line, matching Return Prime/QuickReturns feature set)

- Theme app extension for the actual branded portal UI (currently just the API)
- Return label generation / carrier integration
- Refund execution (Admin API `refundCreate` mutation) once a customer picks refund
- Draft order creation for accepted exchanges (charge/credit the price difference)
- `orderCancel` mutation call when a cancellation is approved (currently we
  record the decision; wiring the actual Shopify order cancellation + refund
  is the next step)
- Executing the RTO `rtoAction` side effect itself (inventory adjust /
  refundCreate) — currently `rto.server.ts` decides the action and records
  it; the mutation call needs to be added to the webhook handler
- Additional automations: auto-approve/reject returns by rule, SLA breach
  flags, policy-override links (request return outside window)

## Running locally

1. `cp .env.example .env` and fill in your Partner Dashboard app credentials
2. `npm install`
3. `npx prisma migrate dev --name init`
4. `npm run dev` (uses Shopify CLI to tunnel + install on your dev store)

The `shopify.app.toml` scopes/webhooks/app-proxy config are already wired
to match this codebase — update `client_id`, `application_url`, and
`dev_store_url` for your Partner Dashboard app.

## Deploying to production (Git + Vercel + Neon/Supabase)

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full step-by-step guide —
creating the Shopify app, pushing to GitHub, setting up Postgres on Neon
or Supabase, deploying to Vercel, and going live.

For an even more literal, copy-paste-one-command-at-a-time version (exact
PowerShell syntax, expected output after each step, and an error table per
step) see **[SETUP-COMMANDS.md](./SETUP-COMMANDS.md)**.
