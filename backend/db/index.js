// SQLite connection + schema.
// Uses better-sqlite3 and stores everything in a single data.sqlite file.

const path = require('path');
const Database = require('better-sqlite3');

// On most hosts (Railway, Render, etc.) the app's own folder is wiped
// on every redeploy — so the database file must NOT live next to the
// code. Set DB_PATH to a path inside a persistent volume in production
// (e.g. /data/data.sqlite on Railway with a volume mounted at /data).
// Falls back to a local file for plain `npm run dev` on your machine.
const DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, 'data.sqlite');

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');


/* ============================================================
   BASE SCHEMA
============================================================ */

db.exec(`

CREATE TABLE IF NOT EXISTS users (

  id
    INTEGER PRIMARY KEY AUTOINCREMENT,

  email
    TEXT NOT NULL UNIQUE,

  password_hash
    TEXT NOT NULL,

  name
    TEXT DEFAULT '',

  created_at
    TEXT NOT NULL
    DEFAULT (datetime('now'))

);


CREATE TABLE IF NOT EXISTS products (

  id
    TEXT PRIMARY KEY,

  name
    TEXT NOT NULL,

  collection
    TEXT,

  type
    TEXT,

  price
    INTEGER NOT NULL,

  description
    TEXT,

  material
    TEXT,

  gemstones
    TEXT,

  dimensions
    TEXT,

  weight
    TEXT,

  images
    TEXT,

  stock
    INTEGER NOT NULL DEFAULT 0,

  is_active
    INTEGER NOT NULL DEFAULT 1,

  created_at
    TEXT NOT NULL
    DEFAULT (datetime('now')),

  updated_at
    TEXT NOT NULL
    DEFAULT (datetime('now'))

);


CREATE TABLE IF NOT EXISTS cart_items (

  id
    INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id
    INTEGER NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  product_id
    TEXT NOT NULL
    REFERENCES products(id)
    ON DELETE CASCADE,

  size
    TEXT,

  qty
    INTEGER NOT NULL DEFAULT 1,

  UNIQUE(user_id, product_id, size)

);


CREATE TABLE IF NOT EXISTS wishlist_items (

  id
    INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id
    INTEGER NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  product_id
    TEXT NOT NULL
    REFERENCES products(id)
    ON DELETE CASCADE,

  UNIQUE(user_id, product_id)

);


CREATE TABLE IF NOT EXISTS orders (

  id
    INTEGER PRIMARY KEY AUTOINCREMENT,

  order_number
    TEXT NOT NULL UNIQUE,

  user_id
    INTEGER
    REFERENCES users(id)
    ON DELETE SET NULL,

  customer_name
    TEXT NOT NULL,

  customer_email
    TEXT NOT NULL,

  customer_phone
    TEXT,

  country
    TEXT,

  currency
    TEXT NOT NULL DEFAULT 'IDR',

  shipping_address
    TEXT NOT NULL,

  payment_method
    TEXT,

  payment_method_label
    TEXT,

  delivery_method
    TEXT,

  delivery_method_label
    TEXT,

  items_json
    TEXT NOT NULL,

  subtotal
    INTEGER NOT NULL,

  shipping_fee
    INTEGER NOT NULL DEFAULT 0,

  total
    INTEGER NOT NULL,

  status
    TEXT NOT NULL DEFAULT 'pending',

  payment_status
    TEXT NOT NULL DEFAULT 'unpaid',

  midtrans_order_id
    TEXT,

  midtrans_token
    TEXT,

  created_at
    TEXT NOT NULL
    DEFAULT (datetime('now')),

  updated_at
    TEXT NOT NULL
    DEFAULT (datetime('now'))

);


CREATE TABLE IF NOT EXISTS password_resets (

  id
    INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id
    INTEGER NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  token_hash
    TEXT NOT NULL,

  expires_at
    TEXT NOT NULL,

  used
    INTEGER NOT NULL DEFAULT 0

);

`);


/* ============================================================
   PRODUCTS MIGRATION
============================================================ */

const productColumns = [

  'material TEXT',
  'gemstones TEXT',
  'dimensions TEXT',
  'weight TEXT'

];


for (const col of productColumns) {

  try {

    db.exec(
      `ALTER TABLE products ADD COLUMN ${col}`
    );

  } catch (e) {

    // Column already exists.

  }

}


/* ============================================================
   ORDERS MIGRATION
   ------------------------------------------------------------
   IMPORTANT:
   data.sqlite already exists, so CREATE TABLE IF NOT EXISTS
   will NOT add new columns to the existing table.

   These migrations add the new checkout fields safely.
============================================================ */

const orderColumns = [

  "country TEXT",

  "currency TEXT NOT NULL DEFAULT 'IDR'",

  "payment_method TEXT",

  "payment_method_label TEXT",

  "delivery_method TEXT",

  "delivery_method_label TEXT",

  // Virtual Account details when paymentMethod is a Midtrans bank
  // transfer (BCA/Mandiri/BNI/Permata) — filled in when the VA is
  // created, cleared once payment/notification marks the order paid.
  "va_bank TEXT",

  "va_number TEXT",

  "va_expiry TEXT"

];


for (const col of orderColumns) {

  try {

    db.exec(
      `ALTER TABLE orders ADD COLUMN ${col}`
    );

  } catch (e) {

    // Column already exists.

  }

}


/* ============================================================
   USERS MIGRATION
   ------------------------------------------------------------
   Newsletter preference used to live only in the browser's
   localStorage (never reached the server, so it was purely
   cosmetic). Storing it on the user row makes it a real,
   account-wide setting.
============================================================ */

const userColumns = [

  "newsletter_opt_in INTEGER NOT NULL DEFAULT 0"

];

for (const col of userColumns) {

  try {

    db.exec(
      `ALTER TABLE users ADD COLUMN ${col}`
    );

  } catch (e) {

    // Column already exists.

  }

}


/* ============================================================
   CONCIERGE ENQUIRIES (Assisted Checkout)
   ------------------------------------------------------------
   CHARMENTIST does not take automatic online payment. A client
   sends a Request (enquiry), the Concierge confirms details,
   availability, price and payment method, then issues written
   payment instructions. Status flow:

   requested -> in_conversation -> confirmed -> payment_instructed
   -> paid -> in_production -> dispatched -> delivered
   (cancelled at any point)

   `allocated` = 1 once the pieces have been deducted from the
   design's production allocation (products.stock) at "confirmed".
============================================================ */

db.exec(`

CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  country TEXT,
  city TEXT,
  preferred_channel TEXT NOT NULL DEFAULT 'whatsapp',
  items_json TEXT NOT NULL,
  indicative_usd INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  allocated INTEGER NOT NULL DEFAULT 0,
  confirmed_amount TEXT,
  payment_instruction TEXT,
  payment_due TEXT,
  tracking_info TEXT,
  admin_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inner_circle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

`);


/* ============================================================
   EXPORT
============================================================ */

module.exports = db;
