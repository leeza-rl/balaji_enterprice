// server.js — Balaji Enterprise backend
// Pure Node.js (no npm install needed). Run with: node server.js

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");
const db = require("./db");

const PORT = process.env.PORT || 3000;

// CHANGE THIS before going live — used to protect admin-only actions.
const ADMIN_KEY = process.env.ADMIN_KEY || "balaji123";
if (ADMIN_KEY === "balaji123") {
  console.warn(
    "\n⚠️  WARNING: You are using the default admin key (\"balaji123\").\n" +
    "   Anyone who knows this can add/edit/delete your products and see all orders.\n" +
    "   Before going live, start the server with your own key, e.g.:\n" +
    "   ADMIN_KEY=your-own-strong-secret node server.js\n"
  );
}

const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  res.end(JSON.stringify(data));
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------- Simple in-memory rate limiter (no npm install needed) ----------
// Protects login/signup from brute-force guessing. Resets if the server restarts —
// fine for a small store; a high-traffic site should use a shared store like Redis.
const rateLimitBuckets = new Map(); // key -> { count, windowStart }
function isRateLimited(key, maxAttempts, windowMs) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    rateLimitBuckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > maxAttempts;
}
function getClientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) { // 1MB cap against oversized payloads
        req.destroy();
        reject(new Error("Payload too large"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function isAdmin(req) {
  const provided = req.headers["x-admin-key"];
  if (!provided) return false;
  return timingSafeStringEqual(provided, ADMIN_KEY);
}

function getToken(req) {
  const auth = req.headers["authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function getCurrentUser(req) {
  const token = getToken(req);
  if (!token) return null;
  return db.getUserByToken(token);
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);

  // prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;

  try {
    // ---------- Public API ----------
    if (pathname === "/api/products" && method === "GET") {
      return sendJSON(res, 200, db.getProducts());
    }

    const productMatch = pathname.match(/^\/api\/products\/(\d+)$/);
    if (productMatch && method === "GET") {
      const product = db.getProduct(productMatch[1]);
      if (!product) return sendJSON(res, 404, { error: "Product not found" });
      return sendJSON(res, 200, product);
    }

    const reviewMatch = pathname.match(/^\/api\/products\/(\d+)\/reviews$/);
    if (reviewMatch && method === "POST") {
      const body = await readBody(req);
      const { name, rating, comment } = body;
      if (!name || !comment || !rating) {
        return sendJSON(res, 400, { error: "name, rating and comment are required" });
      }
      const review = {
        name: String(name).slice(0, 60),
        rating: Math.max(1, Math.min(5, Number(rating))),
        comment: String(comment).slice(0, 500),
        date: "Just now",
      };
      const updated = db.addReview(reviewMatch[1], review);
      if (!updated) return sendJSON(res, 404, { error: "Product not found" });
      return sendJSON(res, 201, updated);
    }

    if (pathname === "/api/orders" && method === "POST") {
      const body = await readBody(req);
      const { name, phone, address, paymentMethod, items } = body;
      if (!name || !phone || !address || !items || !items.length) {
        return sendJSON(res, 400, { error: "name, phone, address and items are required" });
      }
      if (!/^\d{10}$/.test(phone)) {
        return sendJSON(res, 400, { error: "phone must be a valid 10-digit number" });
      }
      const currentUser = getCurrentUser(req);
      const order = db.createOrder({
        name,
        phone,
        address,
        paymentMethod,
        items,
        userId: currentUser ? currentUser.id : null,
      });
      return sendJSON(res, 201, order);
    }

    const orderMatch = pathname.match(/^\/api\/orders\/([A-Za-z0-9]+)$/);
    if (orderMatch && method === "GET") {
      const order = db.getOrder(orderMatch[1]);
      if (!order) return sendJSON(res, 404, { error: "Order not found" });
      return sendJSON(res, 200, order);
    }

    // ---------- Auth & Profile ----------
    if (pathname === "/api/auth/signup" && method === "POST") {
      if (isRateLimited("signup:" + getClientIp(req), 8, 15 * 60 * 1000)) {
        return sendJSON(res, 429, { error: "Too many signup attempts. Please try again in a few minutes." });
      }
      const body = await readBody(req);
      const { name, phone, address, password } = body;
      if (!name || !phone || !password) {
        return sendJSON(res, 400, { error: "name, phone and password are required" });
      }
      if (!/^\d{10}$/.test(phone)) {
        return sendJSON(res, 400, { error: "phone must be a valid 10-digit number" });
      }
      if (String(password).length < 4) {
        return sendJSON(res, 400, { error: "password must be at least 4 characters" });
      }
      const result = db.signup({ name: String(name).slice(0, 80), phone, address: address ? String(address).slice(0, 300) : "", password });
      if (result.error) return sendJSON(res, 400, result);
      return sendJSON(res, 201, result);
    }

    if (pathname === "/api/auth/login" && method === "POST") {
      if (isRateLimited("login:" + getClientIp(req), 10, 15 * 60 * 1000)) {
        return sendJSON(res, 429, { error: "Too many login attempts. Please try again in a few minutes." });
      }
      const body = await readBody(req);
      const { phone, password } = body;
      if (!phone || !password) {
        return sendJSON(res, 400, { error: "phone and password are required" });
      }
      const result = db.login({ phone, password });
      if (result.error) return sendJSON(res, 401, result);
      return sendJSON(res, 200, result);
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      const token = getToken(req);
      if (token) db.logout(token);
      return sendJSON(res, 200, { success: true });
    }

    if (pathname === "/api/profile" && method === "GET") {
      const user = getCurrentUser(req);
      if (!user) return sendJSON(res, 401, { error: "Not logged in" });
      return sendJSON(res, 200, user);
    }

    if (pathname === "/api/profile" && method === "PUT") {
      const user = getCurrentUser(req);
      if (!user) return sendJSON(res, 401, { error: "Not logged in" });
      const body = await readBody(req);
      if (body.phone && !/^\d{10}$/.test(body.phone)) {
        return sendJSON(res, 400, { error: "phone must be a valid 10-digit number" });
      }
      const updated = db.updateProfile(user.id, body);
      return sendJSON(res, 200, updated);
    }

    if (pathname === "/api/profile/orders" && method === "GET") {
      const user = getCurrentUser(req);
      if (!user) return sendJSON(res, 401, { error: "Not logged in" });
      return sendJSON(res, 200, db.getOrdersByUser(user.id));
    }

    // ---------- Admin API (requires x-admin-key header) ----------
    if (pathname.startsWith("/api/admin/")) {
      if (isRateLimited("admin:" + getClientIp(req), 20, 5 * 60 * 1000)) {
        return sendJSON(res, 429, { error: "Too many admin requests. Please slow down." });
      }
    }

    if (pathname === "/api/admin/orders" && method === "GET") {
      if (!isAdmin(req)) return sendJSON(res, 401, { error: "Unauthorized" });
      return sendJSON(res, 200, db.getOrders());
    }

    if (pathname === "/api/admin/products" && method === "POST") {
      if (!isAdmin(req)) return sendJSON(res, 401, { error: "Unauthorized" });
      const body = await readBody(req);
      const created = db.adminAddProduct(body);
      return sendJSON(res, 201, created);
    }

    const adminProductMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
    if (adminProductMatch && method === "PUT") {
      if (!isAdmin(req)) return sendJSON(res, 401, { error: "Unauthorized" });
      const body = await readBody(req);
      const updated = db.adminUpdateProduct(adminProductMatch[1], body);
      if (!updated) return sendJSON(res, 404, { error: "Product not found" });
      return sendJSON(res, 200, updated);
    }

    if (adminProductMatch && method === "DELETE") {
      if (!isAdmin(req)) return sendJSON(res, 401, { error: "Unauthorized" });
      const deleted = db.adminDeleteProduct(adminProductMatch[1]);
      if (!deleted) return sendJSON(res, 404, { error: "Product not found" });
      return sendJSON(res, 200, { success: true });
    }

    // ---------- Static frontend files ----------
    if (method === "GET") {
      return serveStatic(req, res, pathname);
    }

    sendJSON(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: "Server error", detail: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Balaji Enterprise server running at http://localhost:${PORT}`);
  console.log(`Admin key (send as x-admin-key header): ${ADMIN_KEY}`);
});
