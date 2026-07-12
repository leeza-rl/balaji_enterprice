# Balaji Enterprise — Online Store (with Node.js backend)

A kitchen & home essentials store with a real backend: products, reviews, and
orders are now saved on the server instead of only living in the browser.

## How to run it

You need [Node.js](https://nodejs.org) installed (v16 or newer). No `npm install`
is required — this project uses only Node's built-in modules.

```bash
node server.js
```

Then open your browser to:

- **Store:** http://localhost:3000
- **Admin panel:** http://localhost:3000/admin.html
  - Admin key (default): `balaji123`
  - **Change this before going live** — see "Before you launch" below.

To use a different port: `PORT=4000 node server.js`

## What's included

| File/Folder        | Purpose |
|---------------------|---------|
| `server.js`         | The web server — serves the site and the API |
| `db.js`             | Reads/writes the data file (products, orders) |
| `data/seed.json`    | Starting product catalogue (12 kitchen items) |
| `data/store.json`   | Auto-created on first run — this is your live database |
| `public/index.html` | The customer-facing store |
| `public/admin.html` | Admin panel — add/edit/delete products, view orders |

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/products` | List all products |
| GET | `/api/products/:id` | Get one product |
| POST | `/api/products/:id/reviews` | Add a customer review |
| POST | `/api/orders` | Place an order (attaches to logged-in user if any) |
| GET | `/api/orders/:orderId` | Look up an order |
| POST | `/api/auth/signup` | Create a customer account |
| POST | `/api/auth/login` | Log in, returns a token |
| POST | `/api/auth/logout` | Log out (invalidates the token) |
| GET | `/api/profile` | Get the logged-in user's profile *(needs `Authorization: Bearer <token>`)* |
| PUT | `/api/profile` | Update name / phone / address *(needs token)* |
| GET | `/api/profile/orders` | This user's past orders *(needs token)* |
| GET | `/api/admin/orders` | List all orders *(needs `x-admin-key` header)* |
| POST | `/api/admin/products` | Add a product *(admin)* |
| PUT | `/api/admin/products/:id` | Edit a product *(admin)* |
| DELETE | `/api/admin/products/:id` | Delete a product *(admin)* |

## Customer accounts

Customers can now sign up with their name, mobile number, address, and a
password (the "Login" button in the top-right of the store). Once logged in:

- Their name shows in the header instead of "Login"
- Clicking their name opens their **profile** — editable name/phone/address,
  plus a list of their past orders
- Checkout auto-fills their saved name, phone, and address
- Sessions persist across page reloads (a token is kept in the browser's
  local storage) until they log out

Passwords are stored as salted SHA-256 hashes — reasonable for a demo, but
for a real production store, switch to a proper library like bcrypt or
argon2 (this project intentionally avoids `npm install` dependencies).

## Important — this is a demo store

- **Payments are simulated.** Choosing UPI/GPay/Cash on Delivery does not move
  real money. To accept real payments you'll need a payment gateway such as
  [Razorpay](https://razorpay.com), PayU, or Cashfree — they handle the actual
  UPI/card transaction and send your server a confirmation webhook.
- **The database is a single JSON file** (`data/store.json`). This is fine for
  a small catalogue and low order volume, but for a growing business, move to
  a real database (PostgreSQL, MySQL, or MongoDB) so multiple people can place
  orders at the same time safely.
- **Admin login is a single shared password**, not per-user accounts. Fine for
  one shop owner testing things out; not fine for a real team.

## Security — what's protected now, what still needs your action

This project includes real security hardening at the code level:

- ✅ **Passwords** — hashed with PBKDF2 (100,000 iterations) + a unique salt per
  user, using Node's built-in `crypto` module. Plaintext passwords are never stored.
- ✅ **XSS protection** — all user-submitted text (reviews, names, addresses,
  profile fields) is HTML-escaped before being displayed, so a malicious
  review or order can't run script code in another visitor's or the admin's browser.
- ✅ **Brute-force protection** — login, signup, and admin requests are rate-limited
  per IP address (e.g. 10 login attempts per 15 minutes).
- ✅ **Session expiry** — login tokens automatically expire after 30 days.
- ✅ **Timing-safe comparisons** — admin key and password checks use
  `crypto.timingSafeEqual` so response time can't leak information.
- ✅ **Basic security headers** — `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy` on every response.
- ✅ **Path traversal protection** on static file serving.
- ✅ **Request size limits** — request bodies are capped at 1MB.

### What you still need to do before going fully live

1. **Set a real admin key.** The server prints a warning on startup if you're
   still using the default. Set your own:
   ```bash
   ADMIN_KEY=your-own-strong-secret node server.js
   ```
2. **Add HTTPS.** This is the biggest remaining gap and it cannot be fixed in
   code alone — it depends on where you host the site. Without HTTPS, data
   (including passwords) travels in plain text over the network. Options:
   - **Easiest:** deploy to a host that provides free automatic HTTPS —
     Render, Railway, or Fly.io all do this for Node apps.
   - **VPS route:** put the app behind Nginx or Caddy and use
     [Let's Encrypt](https://letsencrypt.org) (via Certbot) for a free certificate.
3. **Move to a real database** once you expect concurrent orders — the
   JSON-file database is fine for testing but isn't built for high traffic
   or simultaneous writes.
4. **Consider a real payment gateway** (Razorpay, PayU, Cashfree) so
   payments are handled by a PCI-compliant provider rather than simulated.
5. **Back up `data/store.json` regularly** once real orders start coming in —
   it's your entire database in one file.

## Before you launch for real

1. **Change the admin key** — set an environment variable instead of using the
   default:
   ```bash
   ADMIN_KEY=your-strong-secret-here node server.js
   ```
2. **Add HTTPS** — deploy behind a host that provides SSL (Render, Railway,
   a VPS with Caddy/Nginx, etc.). Never take real payments over plain HTTP.
3. **Integrate a real payment gateway** so the UPI/GPay/COD choice actually
   charges the customer or confirms a real order.
4. **Move to a proper database** once you expect concurrent orders.
5. **Buy a domain** and point it at your hosting.

If you'd like help with any of these — Razorpay integration, deploying to a
host, or upgrading to a real database — just ask.
