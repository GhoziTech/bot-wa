const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dataDir = path.resolve(process.env.DATA_DIR || __dirname);
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(dataDir, 'bot.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`CREATE TABLE IF NOT EXISTS users (
  phone TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  saldo REAL DEFAULT 0,
  total_order INTEGER DEFAULT 0,
  total_pengeluaran REAL DEFAULT 0,
  no_rekening TEXT,
  registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  price REAL NOT NULL,
  rating REAL DEFAULT 5.0,
  sold INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  stock_mode TEXT DEFAULT 'credential',
  stock_qty INTEGER DEFAULT 0,
  delivery_text TEXT,
  sort_order INTEGER DEFAULT 0
)`);

db.exec(`CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  email TEXT,
  password TEXT,
  is_sold INTEGER DEFAULT 0,
  order_id INTEGER,
  FOREIGN KEY(product_id) REFERENCES products(id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_phone TEXT,
  product_id INTEGER,
  amount REAL,
  status TEXT DEFAULT 'pending',
  credential_id INTEGER,
  payment_method TEXT,
  paid_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_phone) REFERENCES users(phone),
  FOREIGN KEY(product_id) REFERENCES products(id),
  FOREIGN KEY(credential_id) REFERENCES credentials(id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS bot_sessions (
  user_key TEXT PRIMARY KEY,
  reply_jid TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  step TEXT NOT NULL DEFAULT 'idle',
  payload TEXT NOT NULL DEFAULT '{}',
  expires_at INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS admin_sessions (
  admin_key TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 0,
  step TEXT NOT NULL DEFAULT 'idle',
  payload TEXT NOT NULL DEFAULT '{}',
  expires_at INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS message_events (
  message_id TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_phone TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  reference TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_phone) REFERENCES users(phone)
)`);

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

function addColumn(table, definition) {
  const column = definition.trim().split(/\s+/)[0];
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    console.log(`[DB MIGRATION] ${table}.${column} ditambahkan`);
  }
}

// Migrasi aman untuk database lama yang sudah berjalan.
addColumn('products', "stock_mode TEXT DEFAULT 'credential'");
addColumn('products', 'stock_qty INTEGER DEFAULT 0');
addColumn('products', 'delivery_text TEXT');
addColumn('products', 'sort_order INTEGER DEFAULT 0');
addColumn('orders', 'payment_method TEXT');
addColumn('orders', 'paid_at DATETIME');

db.exec(`CREATE INDEX IF NOT EXISTS idx_credentials_available
  ON credentials(product_id, is_sold, id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders(status, id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_products_active
  ON products(is_active, sort_order, id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_wallet_user
  ON wallet_transactions(user_phone, id)`);

console.log(`[DB] SQLite aktif: ${dbPath}`);

module.exports = db;
