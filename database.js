const Database = require('better-sqlite3');
const db = new Database('bot.db');
db.pragma('journal_mode = WAL');

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
    is_active INTEGER DEFAULT 1
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_phone) REFERENCES users(phone),
    FOREIGN KEY(product_id) REFERENCES products(id),
    FOREIGN KEY(credential_id) REFERENCES credentials(id)
)`);
module.exports = db;
