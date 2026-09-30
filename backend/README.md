# CHARMENTIST backend

A small Node.js/Express API that gives the CHARMENTIST site real accounts,
a real product database, a cart/wishlist tied to your account (not your
browser), and the **Concierge / Assisted Checkout** flow: clients send a
Request, a human Concierge confirms everything and writes payment
instructions by hand — there is no automatic online payment.

Everything lives in one SQLite file (`db/data.sqlite`) — no separate
database server to install or pay for.

## The Concierge / Assisted Checkout flow

This is the core of the storefront now, replacing the old automatic
checkout:

1. A client browses, adds pieces to their selection, and on
   `checkout.html` fills in their contact details and sends a **Request**
   (`POST /api/enquiries`) — no payment field exists anywhere in this
   step, and prices are read from the database, never trusted from the
   browser.
2. You (the Concierge) see it appear in `admin.html` → **Concierge
   Requests** tab. You talk to the client on WhatsApp/email, confirm the
   piece, sizing, and final price.
3. In `admin.html`, you move the request to **Order Confirmed** — this is
   the moment the pieces are deducted from that design's One-Time
   Production allocation (`products.stock`), so a design can never be
   over-sold across simultaneous requests. If two people request the
   last piece, whoever the Concierge confirms first gets it; confirming
   the second is refused with a clear error.
4. You write the payment instruction (bank transfer details, etc.) into
   the same screen and move status to **Payment Instructions Sent** — the
   API refuses this move if the instruction text is empty, so a client
   can never be sent a blank/broken instruction by mistake.
5. Once you've received payment, mark **Payment Received**, then
   **In Production → Dispatched → Delivered** as the order actually
   progresses. Every status change emails the client automatically
   (see `utils/enquiryMail.js`).
6. Clients can check their own status any time on `track-order.html`
   with their reference + email, or from `account.html` → **My Requests**
   if they're signed in.
7. Cancelling a request at any point (**Cancelled / Closed**) returns any
   deducted allocation back to that design's stock automatically.

**Nothing about payment is ever generated automatically** — the payment
instruction shown to a client is always exactly what the Concierge typed
into the admin dashboard. This is intentional: CHARMENTIST is positioned
as a personal purchasing experience, not a self-service e-commerce
checkout.

## What's wired up already (frontend side)

- `assets/js/auth.js` — sign in / sign up / change password now call this
  API instead of storing plaintext passwords in the browser.
- `assets/js/store.js` — cart & wishlist sync to the account when logged
  in (local-first, so pages stay instant; background sync to match).
- `assets/js/products.js` — pulls the live catalog from `/api/products`
  on every page load (price, stock/allocation, new/removed pieces), with
  the bundled static list as an instant-render fallback if the API is
  unreachable.
- `checkout.html` — sends a Concierge Request (`POST /api/enquiries`).
  Contact details are validated both client-side (instant feedback) and
  server-side in `routes/enquiries.js` (what actually protects the
  database).
- `track-order.html` — looks up a request by reference + email
  (`POST /api/enquiries/track`) with no login required.
- `account.html` — "My Requests" reads from `GET /api/enquiries` instead
  of localStorage, so it's the same across devices.
- `admin.html` — a dashboard (open it directly in a browser) with a
  **Concierge Requests** tab (the main daily workflow) and a **Products**
  tab to manage the catalog and each design's remaining production
  allocation, protected by your `ADMIN_KEY`. A **Legacy Orders** tab is
  still there for historical records from the old automatic checkout,
  but the storefront no longer creates new rows there.

## 1. Install

Requires Node.js 18+.

```bash
cd backend
npm install
cp .env.example .env
```

Open `.env` and fill in:
- `JWT_SECRET` — any long random string (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
- `ADMIN_KEY` — same idea, used to protect the admin endpoints
- `CORS_ORIGIN` — the URL(s) your site will actually be served from

Leave `SMTP_*` blank for now — the API still works without it (status
emails to clients just won't send yet; everything else works). The
`MIDTRANS_*` variables are no longer used by the storefront and can stay
blank — they're only kept for the legacy `/api/orders` endpoint.

## 2. Load your products into the database

Your existing `assets/js/products.js` is the source of truth for what's
in your shop. Copy it in and seed the database from it:

```bash
cp ../CHARMENTIST_Website/assets/js/products.js data/products-source.js
npm run seed
```

Re-run `npm run seed` any time you edit `products-source.js` — it
updates existing rows instead of duplicating them. Once you're managing
products through `admin.html` day-to-day, you generally won't need to
re-run this — it's really just for the initial import.

**Important — allocation, not a shopping-cart stock count:** each
product's `stock` field is its **One-Time Production allocation** — how
many pieces of that design will ever exist, taken from `pcsTarget` in
`products.js`. It only ever decreases when a Concierge confirms a Request
in `admin.html` (never from a client simply browsing or adding to their
selection), and it goes back up if that request is later cancelled. At 0,
the design shows as **Permanently Retired** on the storefront. Re-running
`npm run seed` never resets an existing design's remaining allocation —
it only adds newly-added designs.

**On pricing:** the prices in `products.js` right now aren't confirmed
to a specific currency. Before going live, make sure every product's
`price` is the real amount in whichever currency you'll quote (e.g. a
Rp 11,400,000 piece stored as `11400000`), then re-run the seed — or
correct prices directly in `admin.html` after seeding once. Since final
pricing is always confirmed by a Concierge before any payment, small
pricing adjustments don't need to be urgent — but the indicative total
shown to clients should still be accurate.

## 3. Run it

```bash
npm start          # production
npm run dev         # auto-restarts on file changes
```

The API is now at `http://localhost:4000/api`. Test it:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/products
```

## 4. Point the frontend at it

By default the frontend scripts call `http://localhost:4000/api`. Once
you deploy this backend somewhere with a real URL, add one line near the
top of each HTML page's `<head>` (before the other `<script>` tags):

<script>window.CHARM_API_BASE = 'https://your-backend.example.com/api';</script>
```

## 5. Payment — handled by your Concierge, not this backend

There is no payment gateway to configure for the storefront itself.
Once you confirm a Request in `admin.html`, you type your real payment
instructions (bank name, account number, account holder, amount, any
reference the client should use) directly into the **Payment
instruction** field — that's exactly what gets emailed to the client.
Keep it accurate and update it if your bank details ever change; there's
nothing to "deploy" here.

*(The `MIDTRANS_*` settings and `/api/payment/notification` webhook are
left in the codebase only because `routes/orders.js`, the old automatic
checkout, still references them. They're unused by the current
storefront and safe to ignore.)*

## 6. Set up email (order confirmations, password reset)

Any SMTP provider works. Two easy options:
- **Resend** (https://resend.com) — free tier, simple API, SMTP details
  are on their dashboard.
- **Gmail** — use an "app password" (not your normal password) as
  `SMTP_PASS`, `smtp.gmail.com` port 587 as `SMTP_HOST`/`SMTP_PORT`.

Fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`
in `.env`. Until these are set, the backend just logs what it would have
sent — nothing breaks, emails just don't go out.

## 7. Running the shop day-to-day: admin.html

Open `admin.html` directly in a browser (no build step needed) and enter
your `ADMIN_KEY`. From there you can:
- **Concierge Requests** (the main tab) — see every Request, open one to
  read the client's details and pieces, move it through the status flow,
  write the confirmed amount and payment instruction, and see at a
  glance whether its pieces have been deducted from that design's
  allocation yet.
- **Products** — see every design, edit price/allocation inline,
  deactivate one (soft-delete — hides it from the storefront without
  deleting its request history), and add brand new designs without
  touching any code. The allocation shown here is what goes to zero
  when a design becomes Permanently Retired.
- **Legacy Orders** — read-only history from the old automatic checkout,
  kept only so past records aren't lost.

Since it's a static HTML file, you can put it anywhere — even just open
it from your own computer — as long as `window.CHARM_API_BASE` (or the
`http://localhost:4000/api` default) points at your running backend.
Keep the URL to this file private/unlisted; the `ADMIN_KEY` is the only
thing gating access to it.

## 8. Deploy

Cheapest reliable options for a small store:
- **Railway** (https://railway.app) or **Render** (https://render.com) —
  connect your GitHub repo, they detect `npm start` automatically. Add
  all your `.env` values as environment variables in their dashboard.
  Note: SQLite needs a persistent disk/volume on these platforms (both
  offer one) so `db/data.sqlite` survives restarts/deploys.
- A small VPS (DigitalOcean, etc.) with `pm2` to keep the process alive.

Whichever you choose, set `CORS_ORIGIN` to your real storefront domain
and `FRONTEND_URL` to the same, so password-reset emails link correctly.

## API reference (quick)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | – | Create account |
| POST | `/api/auth/login` | – | Sign in |
| GET | `/api/auth/exists?email=` | – | Used by the sign-in page's 2-step flow |
| GET | `/api/auth/me` | Bearer | Current user |
| PATCH | `/api/auth/me` | Bearer | Update name |
| POST | `/api/auth/change-password` | Bearer | Change password |
| POST | `/api/auth/forgot-password` | – | Sends reset email |
| POST | `/api/auth/reset-password` | – | Sets new password from emailed token |
| GET | `/api/products` | – | List products (`?collection=&type=&q=`) |
| GET | `/api/products/:id` | – | Product detail |
| GET/POST/PATCH/DELETE | `/api/cart` | Bearer | Cart tied to account |
| GET/POST | `/api/wishlist` | Bearer | Wishlist tied to account |
| POST | `/api/enquiries` | optional | Send a Concierge Request (guest allowed) — no payment |
| POST | `/api/enquiries/track` | – | Client looks up a request by reference + email |
| GET | `/api/enquiries` | Bearer | My requests ("My Requests" in account.html) |
| POST | `/api/enquiries/inner-circle` | – | Private-invitation list sign-up |
| GET | `/api/admin/enquiries` | `x-admin-key` header | List/filter all requests |
| PATCH | `/api/admin/enquiries/:id` | `x-admin-key` header | Move status, write payment instruction, etc. — deducts/restores production allocation automatically |
| POST/PATCH/DELETE | `/api/admin/products` | `x-admin-key` header | Manage catalog & production allocation |
| — legacy, unused by the storefront — | | | |
| POST | `/api/orders` | optional | Old automatic checkout (superseded by `/api/enquiries`) |
| GET | `/api/orders` | Bearer | Old order history |
| GET | `/api/orders/:orderNumber` | – | Old order status lookup |
| POST | `/api/payment/notification` | Midtrans only | Old payment webhook |
| GET/PATCH | `/api/admin/orders` | `x-admin-key` header | "Legacy Orders" tab — historical records only |
| POST | `/api/admin/orders/:id/cancel-refund` | `x-admin-key` header | Cancel/refund an old order via Midtrans |

## What's still manual / not built

- **Your real contact details** — `assets/js/config.js` → `window.CHARM_CONTACT`
  has placeholder WhatsApp number, email, and social links. Update it
  once and every page (footer, Contact, Appointment, checkout success
  screen) picks it up automatically.
- **HTTPS, backups, domain, deployment** — all environment/infra setup,
  not code. See "Deploy" above for the deployment part; database backup
  is just periodically copying `db/data.sqlite` somewhere safe (or using
  your hosting platform's volume snapshot feature, if it has one).
- **Shipping rate calculation** — shipping cost isn't computed anywhere
  automatically; under Assisted Checkout your Concierge confirms
  shipping cost with the client as part of confirming the order, the
  same way final price and payment method are confirmed.
- **Staff/multi-admin accounts** — right now "admin" is a single shared
  key. Fine solo; if you bring on staff, replace `requireAdmin` in
  routes/admin.js with a proper `role` column + login instead.
