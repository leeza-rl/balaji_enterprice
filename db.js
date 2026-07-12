// db.js — a tiny file-based "database".
// For a real production store, swap this for Postgres/MySQL/MongoDB.
// This version needs ZERO npm installs, so it runs anywhere Node runs.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_FILE = path.join(__dirname, "data", "store.json");
const SEED_FILE = path.join(__dirname, "data", "seed.json");

function ensureDbExists() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = fs.readFileSync(SEED_FILE, "utf8");
    fs.writeFileSync(DB_FILE, seed);
  }
}

function load() {
  ensureDbExists();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ---------- Products ----------
function getProducts() {
  return load().products;
}

function getProduct(id) {
  return load().products.find((p) => p.id === Number(id));
}

function addReview(id, review) {
  const db = load();
  const product = db.products.find((p) => p.id === Number(id));
  if (!product) return null;
  product.reviews.unshift(review);
  save(db);
  return product;
}

// ---------- Admin: product management ----------
function adminAddProduct(product) {
  const db = load();
  const nextId = db.products.length
    ? Math.max(...db.products.map((p) => p.id)) + 1
    : 1;
  const newProduct = { ...product, id: nextId, reviews: product.reviews || [] };
  db.products.push(newProduct);
  save(db);
  return newProduct;
}

function adminUpdateProduct(id, fields) {
  const db = load();
  const idx = db.products.findIndex((p) => p.id === Number(id));
  if (idx === -1) return null;
  db.products[idx] = { ...db.products[idx], ...fields, id: db.products[idx].id };
  save(db);
  return db.products[idx];
}

function adminDeleteProduct(id) {
  const db = load();
  const before = db.products.length;
  db.products = db.products.filter((p) => p.id !== Number(id));
  save(db);
  return db.products.length < before;
}

// ---------- Orders ----------
function createOrder({ name, phone, address, paymentMethod, items, userId }) {
  const db = load();
  let subtotal = 0;
  const orderItems = [];

  for (const item of items) {
    const product = db.products.find((p) => p.id === Number(item.id));
    if (!product) continue;
    const lineTotal = product.price * item.qty;
    subtotal += lineTotal;
    orderItems.push({
      id: product.id,
      name: product.name,
      price: product.price,
      qty: item.qty,
      lineTotal,
    });
  }

  const delivery = subtotal > 0 && subtotal < 500 ? 40 : 0;
  const total = subtotal + delivery;
  const orderId = "BE" + db.nextOrderNum;
  db.nextOrderNum += 1;

  const order = {
    orderId,
    userId: userId || null,
    name,
    phone,
    address,
    paymentMethod,
    items: orderItems,
    subtotal,
    delivery,
    total,
    status: "placed",
    createdAt: new Date().toISOString(),
  };

  db.orders.unshift(order);
  save(db);
  return order;
}

function getOrdersByUser(userId) {
  return load().orders.filter((o) => o.userId === userId);
}

function getOrders() {
  return load().orders;
}

function getOrder(orderId) {
  return load().orders.find((o) => o.orderId === orderId);
}

// ---------- Users & Auth ----------
// PBKDF2 with 100,000 iterations — built into Node core (no npm install needed)
// and far more brute-force resistant than a plain SHA-256 hash.
const PBKDF2_ITERATIONS = 100000;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, "sha512").toString("hex");
}

function passwordMatches(password, salt, storedHash) {
  const computed = Buffer.from(hashPassword(password, salt), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (computed.length !== stored.length) return false;
  return crypto.timingSafeEqual(computed, stored);
}

function signup({ name, phone, address, password }) {
  const db = load();
  if (db.users.find((u) => u.phone === phone)) {
    return { error: "An account with this phone number already exists." };
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const nextId = db.users.length ? Math.max(...db.users.map((u) => u.id)) + 1 : 1;
  const user = {
    id: nextId,
    name,
    phone,
    address: address || "",
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);

  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[token] = { userId: user.id, expiresAt: Date.now() + SESSION_LIFETIME_MS };
  save(db);
  return { token, user: publicUser(user) };
}

function login({ phone, password }) {
  const db = load();
  const user = db.users.find((u) => u.phone === phone);
  if (!user) return { error: "Incorrect phone number or password." };
  if (!passwordMatches(password, user.salt, user.passwordHash)) {
    return { error: "Incorrect phone number or password." };
  }
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[token] = { userId: user.id, expiresAt: Date.now() + SESSION_LIFETIME_MS };
  save(db);
  return { token, user: publicUser(user) };
}

function logout(token) {
  const db = load();
  delete db.sessions[token];
  save(db);
}

function getUserByToken(token) {
  const db = load();
  const session = db.sessions[token];
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    delete db.sessions[token];
    save(db);
    return null;
  }
  const user = db.users.find((u) => u.id === session.userId);
  return user ? publicUser(user) : null;
}

function updateProfile(userId, fields) {
  const db = load();
  const idx = db.users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;
  const { name, phone, address } = fields;
  db.users[idx] = {
    ...db.users[idx],
    ...(name !== undefined ? { name } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(address !== undefined ? { address } : {}),
  };
  save(db);
  return publicUser(db.users[idx]);
}

function publicUser(user) {
  // never send salt/passwordHash to the client
  const { salt, passwordHash, ...safe } = user;
  return safe;
}

module.exports = {
  getProducts,
  getProduct,
  addReview,
  adminAddProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  createOrder,
  getOrders,
  getOrdersByUser,
  getOrder,
  signup,
  login,
  logout,
  getUserByToken,
  updateProfile,
};
