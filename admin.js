const db = require('./database');
const inventory = require('./inventory');
const { applyCatalogPreset } = require('./catalog-preset');

const OWNER_PHONE = String(process.env.OWNER_PHONE || '6285727688928').replace(/\D/g, '');
const ADMIN_PIN = String(process.env.ADMIN_PIN || '').trim();
const ADMIN_SESSION_SECONDS = Math.max(300, Number(process.env.ADMIN_SESSION_SECONDS || 900));

function nowSeconds() { return Math.floor(Date.now() / 1000); }
function parsePayload(value) { try { return JSON.parse(value || '{}'); } catch (_) { return {}; } }

function extractText(msg) {
  return (msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '').trim();
}

function getRecipientJid(userKey) {
  const session = db.prepare('SELECT reply_jid FROM bot_sessions WHERE user_key=?').get(userKey);
  if (session?.reply_jid) return session.reply_jid;
  if (String(userKey).startsWith('lid:')) return `${String(userKey).slice(4)}@lid`;
  return `${String(userKey).replace(/\D/g, '')}@s.whatsapp.net`;
}

function getAdminSession() {
  const row = db.prepare('SELECT * FROM admin_sessions WHERE admin_key=?').get(OWNER_PHONE);
  if (!row || !row.active || Number(row.expires_at) < nowSeconds()) return { active: false, step: 'idle', payload: {} };
  return { active: true, step: row.step, payload: parsePayload(row.payload) };
}

function saveAdminSession(step, payload = {}, active = true) {
  db.prepare(`
    INSERT INTO admin_sessions (admin_key, active, step, payload, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(admin_key) DO UPDATE SET
      active=excluded.active, step=excluded.step, payload=excluded.payload,
      expires_at=excluded.expires_at, updated_at=CURRENT_TIMESTAMP
  `).run(OWNER_PHONE, active ? 1 : 0, step, JSON.stringify(payload), active ? nowSeconds() + ADMIN_SESSION_SECONDS : 0);
}

function isAdminSessionActive() { return getAdminSession().active; }
function money(value) { return Number(value || 0).toLocaleString('id-ID'); }

async function send(sock, to, text) { return sock.sendMessage(to, { text }); }

async function sendAdminMenu(sock, to) {
  saveAdminSession('main');
  return send(sock, to,
`🛠️ *ADMIN PANEL GHOTZITECH*

1. 📊 Lihat seluruh stock
2. ➕ Tambah stock angka
3. 🎯 Set stock langsung
4. 🔐 Tambah akun/link unik
5. 🔗 Set pesan/link pengiriman otomatis
6. ✅ Verifikasi order QRIS
7. 💰 Tambah saldo user
8. 📋 Lihat order pending
9. ⚙️ Atur mode stock produk
10. 🧩 Terapkan preset katalog & stock awal
11. 📤 Selesaikan order manual
0. 🔒 Keluar Admin

Setelah masuk panel, mayoritas proses cukup membalas dengan angka.`);
}

function productStockRows() {
  return db.prepare(`
    SELECT p.id, p.name, p.stock_mode,
      CASE WHEN COALESCE(p.stock_mode,'credential')='credential'
        THEN (SELECT COUNT(*) FROM credentials c WHERE c.product_id=p.id AND c.is_sold=0)
        ELSE COALESCE(p.stock_qty,0)
      END AS stock
    FROM products p WHERE p.is_active=1 ORDER BY p.id
  `).all();
}

async function sendProductAdminList(sock, to, footer = 'Kirim ID produk.') {
  const rows = productStockRows();
  let text = '📦 *DAFTAR PRODUK & STOCK*\n\n';
  rows.forEach((item) => {
    const mode = item.stock_mode === 'credential' ? 'UNIK' : item.stock_mode === 'manual' ? 'MANUAL' : 'ANGKA';
    text += `${item.id}. ${item.name}\n   Stock ${item.stock} • Mode ${mode}\n`;
  });
  text += `\n${footer}`;
  return send(sock, to, text);
}

async function verifyAndSend(sock, to, orderId) {
  if (!Number.isInteger(orderId) || orderId < 1) return send(sock, to, '❌ Nomor order tidak valid.');
  const result = inventory.verifyPendingOrder(orderId);
  if (!result.ok) return send(sock, to, `❌ ${result.error}`);

  await sock.sendMessage(getRecipientJid(result.order.user_phone), {
    text: inventory.customerMessage(result)
  });
  return send(sock, to, `✅ Order #${orderId} terverifikasi. Stock otomatis berkurang dan customer sudah diberi notifikasi.`);
}

async function topupAndNotify(sock, to, userKey, amount) {
  if (!userKey || !Number.isInteger(amount) || amount < 1) return send(sock, to, '❌ Data top up tidak valid.');
  const result = db.prepare('UPDATE users SET saldo=saldo+? WHERE phone=?').run(amount, userKey);
  if (!result.changes) return send(sock, to, '❌ Pengguna tidak ditemukan. Pastikan user pernah mengirim #mulai.');
  await sock.sendMessage(getRecipientJid(userKey), {
    text: `💰 *TOP UP BERHASIL*\n\nSaldo bertambah Rp ${money(amount)}.\nKirim *#mulai* untuk membeli produk melalui saldo.`
  });
  return send(sock, to, `✅ Saldo ${userKey} bertambah Rp ${money(amount)}.`);
}

async function handleDirectCommand(sock, msg, text) {
  const from = msg.key.remoteJid;
  const args = text.slice(1).trim().split(/\s+/);
  const cmd = String(args[0] || '').toLowerCase();

  if (cmd === 'admin') {
    if (!ADMIN_PIN) return send(sock, from, '❌ ADMIN_PIN belum diatur di Railway Variables.');
    if (args[1] !== ADMIN_PIN) return send(sock, from, '❌ PIN admin salah.');
    return sendAdminMenu(sock, from);
  }

  if (cmd === 'help') {
    return send(sock, from, 'Gunakan */admin PIN_ANDA* untuk membuka panel admin angka.');
  }

  // Command kompatibilitas tetap tersedia hanya dari chat diri sendiri.
  if (cmd === 'verifikasi') return verifyAndSend(sock, from, Number.parseInt(args[1], 10));
  if (cmd === 'topup') return topupAndNotify(sock, from, args[1], Number.parseInt(args[2], 10));

  if (cmd === 'addcred') {
    const productId = Number.parseInt(args[1], 10);
    const email = args[2];
    const password = args.slice(3).join(' ');
    if (!productId || !email || !password) return send(sock, from, 'Format: /addcred <product_id> <email/user> <password/kode>');
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(productId);
    if (!product) return send(sock, from, '❌ Produk tidak ditemukan.');
    db.prepare("UPDATE products SET stock_mode='credential' WHERE id=?").run(productId);
    db.prepare('INSERT INTO credentials (product_id, email, password) VALUES (?, ?, ?)').run(productId, email, password);
    return send(sock, from, '✅ Stock unik ditambahkan dan mode produk diset ke credential.');
  }

  if (cmd === 'kirim') {
    const orderId = Number.parseInt(args[1], 10);
    const content = args.slice(2).join(' ');
    const result = inventory.completeProcessingOrder(orderId, content);
    if (!result.ok) return send(sock, from, `❌ ${result.error}`);
    await sock.sendMessage(getRecipientJid(result.order.user_phone), { text: inventory.customerMessage(result) });
    return send(sock, from, `✅ Order #${orderId} selesai dan data produk sudah dikirim.`);
  }
}

async function handleAdminMessage(sock, msg) {
  const to = msg.key.remoteJid;
  const text = extractText(msg);
  if (!text) return;
  if (text.startsWith('/')) return handleDirectCommand(sock, msg, text);

  const session = getAdminSession();
  if (!session.active) return;
  saveAdminSession(session.step, session.payload);

  const number = /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;

  if (session.step === 'main') {
    if (number === 1) { saveAdminSession('view_stock'); return sendProductAdminList(sock, to, 'Balas *0* untuk kembali ke Admin Panel.'); }
    if (number === 2) { saveAdminSession('add_qty_product'); return sendProductAdminList(sock, to, 'Kirim *ID produk* yang ingin ditambah stock.'); }
    if (number === 3) { saveAdminSession('set_qty_product'); return sendProductAdminList(sock, to, 'Kirim *ID produk* yang stock-nya ingin diset.'); }
    if (number === 4) { saveAdminSession('add_unique_product'); return sendProductAdminList(sock, to, 'Kirim *ID produk* untuk menambahkan akun/link unik.'); }
    if (number === 5) { saveAdminSession('delivery_product'); return sendProductAdminList(sock, to, 'Kirim *ID produk* untuk mengatur pesan/link otomatis.'); }
    if (number === 6) { saveAdminSession('verify_order'); return send(sock, to, '✅ Kirim *nomor order* yang akan diverifikasi.'); }
    if (number === 7) { saveAdminSession('topup_user'); return send(sock, to, '💰 Kirim nomor/ID user. Contoh: 628123456789'); }
    if (number === 8) {
      saveAdminSession('view_pending');
      const orders = db.prepare(`SELECT o.id, o.user_phone, p.name, o.amount, o.created_at FROM orders o JOIN products p ON p.id=o.product_id WHERE o.status='pending' ORDER BY o.id DESC LIMIT 20`).all();
      let out = '📋 *ORDER PENDING*\n\n';
      if (!orders.length) out += 'Tidak ada order pending.';
      else orders.forEach((o) => { out += `#${o.id} • ${o.name}\nUser ${o.user_phone} • Rp ${money(o.amount)}\n${o.created_at}\n\n`; });
      out += '\nBalas *0* untuk Admin Panel.';
      return send(sock, to, out);
    }
    if (number === 9) { saveAdminSession('mode_product'); return sendProductAdminList(sock, to, 'Kirim *ID produk* yang ingin diatur mode stock-nya.'); }
    if (number === 10) { saveAdminSession('preset_confirm'); return send(sock, to, '⚠️ Terapkan preset harga, deskripsi, sold, dan stock awal yang Anda berikan?\n\n1. Ya, terapkan satu kali\n2. Batal'); }
    if (number === 11) { saveAdminSession('complete_order'); return send(sock, to, '📤 Kirim nomor order berstatus *processing* yang ingin diselesaikan.'); }
    if (number === 0) { saveAdminSession('idle', {}, false); return send(sock, to, '🔒 Admin Panel ditutup.'); }
    return;
  }


  if (session.step === 'view_stock' || session.step === 'view_pending') {
    if (number === 0) return sendAdminMenu(sock, to);
    return;
  }

  if (number === 0 && !['add_unique_data', 'delivery_text', 'complete_delivery'].includes(session.step)) return sendAdminMenu(sock, to);

  if (session.step === 'add_qty_product') {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(number);
    if (!product) return send(sock, to, '❌ Produk tidak ditemukan. Kirim ID yang benar.');
    if (product.stock_mode === 'credential') return send(sock, to, '❌ Produk mode UNIK. Gunakan menu 4 untuk memasukkan akun/link satu per satu, atau ubah mode melalui menu 9.');
    saveAdminSession('add_qty_amount', { productId: product.id, name: product.name });
    return send(sock, to, `➕ ${product.name}\nKirim jumlah stock yang ingin *ditambahkan*. Contoh: 10`);
  }
  if (session.step === 'add_qty_amount') {
    if (!number || number < 1) return send(sock, to, '❌ Jumlah minimal 1.');
    db.prepare('UPDATE products SET stock_qty=stock_qty+? WHERE id=?').run(number, session.payload.productId);
    const product = inventory.getProductWithStock(session.payload.productId);
    await send(sock, to, `✅ Stock ${session.payload.name} bertambah ${number}. Stock sekarang: ${product.stock}.`);
    return sendAdminMenu(sock, to);
  }

  if (session.step === 'set_qty_product') {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(number);
    if (!product) return send(sock, to, '❌ Produk tidak ditemukan.');
    if (product.stock_mode === 'credential') return send(sock, to, '❌ Produk mode UNIK. Stock mengikuti jumlah data akun/link yang tersedia.');
    saveAdminSession('set_qty_amount', { productId: product.id, name: product.name });
    return send(sock, to, `🎯 ${product.name}\nKirim jumlah stock baru. Boleh 0.`);
  }
  if (session.step === 'set_qty_amount') {
    if (number === null || number < 0) return send(sock, to, '❌ Stock harus angka 0 atau lebih.');
    db.prepare('UPDATE products SET stock_qty=? WHERE id=?').run(number, session.payload.productId);
    await send(sock, to, `✅ Stock ${session.payload.name} diset menjadi ${number}.`);
    return sendAdminMenu(sock, to);
  }

  if (session.step === 'add_unique_product') {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(number);
    if (!product) return send(sock, to, '❌ Produk tidak ditemukan.');
    saveAdminSession('add_unique_data', { productId: product.id, name: product.name });
    return send(sock, to, `🔐 ${product.name}\nKirim data dengan format:\n*email/user | password/kode*\n\nContoh: akun@email.com | KODE-123`);
  }
  if (session.step === 'add_unique_data') {
    const parts = text.split('|').map((item) => item.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) return send(sock, to, '❌ Format salah. Gunakan: email/user | password/kode');
    db.prepare("UPDATE products SET stock_mode='credential' WHERE id=?").run(session.payload.productId);
    db.prepare('INSERT INTO credentials (product_id, email, password) VALUES (?, ?, ?)').run(session.payload.productId, parts[0], parts.slice(1).join(' | '));
    const product = inventory.getProductWithStock(session.payload.productId);
    await send(sock, to, `✅ Data unik ditambahkan ke ${session.payload.name}. Stock sekarang: ${product.stock}.`);
    return sendAdminMenu(sock, to);
  }

  if (session.step === 'delivery_product') {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(number);
    if (!product) return send(sock, to, '❌ Produk tidak ditemukan.');
    saveAdminSession('delivery_text', { productId: product.id, name: product.name });
    return send(sock, to, `🔗 ${product.name}\nKirim pesan/link yang akan dikirim otomatis setelah pembayaran.\n\nContoh:\nLink aktivasi: https://...\nKode: ...\nPetunjuk: ...`);
  }
  if (session.step === 'delivery_text') {
    if (text.length < 3) return send(sock, to, '❌ Pesan terlalu pendek.');
    db.prepare("UPDATE products SET delivery_text=?, stock_mode='quantity' WHERE id=?").run(text, session.payload.productId);
    await send(sock, to, `✅ Pesan pengiriman otomatis ${session.payload.name} sudah disimpan. Mode diubah menjadi ANGKA.`);
    return sendAdminMenu(sock, to);
  }

  if (session.step === 'verify_order') {
    if (!number) return send(sock, to, '❌ Nomor order tidak valid.');
    await verifyAndSend(sock, to, number);
    return sendAdminMenu(sock, to);
  }

  if (session.step === 'topup_user') {
    if (!text) return;
    saveAdminSession('topup_amount', { userKey: text.replace(/\s+/g, '') });
    return send(sock, to, `User: ${text}\nKirim jumlah saldo yang akan ditambahkan. Contoh: 50000`);
  }
  if (session.step === 'topup_amount') {
    if (!number || number < 1) return send(sock, to, '❌ Jumlah saldo tidak valid.');
    await topupAndNotify(sock, to, session.payload.userKey, number);
    return sendAdminMenu(sock, to);
  }

  if (session.step === 'mode_product') {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(number);
    if (!product) return send(sock, to, '❌ Produk tidak ditemukan.');
    saveAdminSession('mode_select', { productId: product.id, name: product.name });
    return send(sock, to, `⚙️ ${product.name}\n\n1. ANGKA — stock ditambah/set dengan angka\n2. UNIK — setiap akun/link dimasukkan satu per satu\n3. MANUAL — stock angka, pengiriman diproses admin\n0. Batal`);
  }
  if (session.step === 'mode_select') {
    const modes = { 1: 'quantity', 2: 'credential', 3: 'manual' };
    if (!modes[number]) return send(sock, to, '❌ Pilih 1, 2, atau 3.');
    db.prepare('UPDATE products SET stock_mode=? WHERE id=?').run(modes[number], session.payload.productId);
    await send(sock, to, `✅ Mode stock ${session.payload.name} diubah menjadi ${modes[number].toUpperCase()}.`);
    return sendAdminMenu(sock, to);
  }

  if (session.step === 'preset_confirm') {
    if (number === 2) return sendAdminMenu(sock, to);
    if (number !== 1) return;
    const result = applyCatalogPreset();
    await send(sock, to, result.ok
      ? `✅ ${result.message}\nProduk tidak ditemukan: ${result.missing.length ? result.missing.join(', ') : 'tidak ada'}.\nListing yang mengandung CRACK dinonaktifkan.`
      : `ℹ️ ${result.message}`);
    return sendAdminMenu(sock, to);
  }

  if (session.step === 'complete_order') {
    if (!number) return send(sock, to, '❌ Nomor order tidak valid.');
    const order = db.prepare("SELECT * FROM orders WHERE id=? AND status='processing'").get(number);
    if (!order) return send(sock, to, '❌ Order processing tidak ditemukan.');
    saveAdminSession('complete_delivery', { orderId: number });
    return send(sock, to, '📤 Kirim data produk/link/akun yang akan diteruskan kepada customer.');
  }
  if (session.step === 'complete_delivery') {
    const result = inventory.completeProcessingOrder(session.payload.orderId, text);
    if (!result.ok) return send(sock, to, `❌ ${result.error}`);
    await sock.sendMessage(getRecipientJid(result.order.user_phone), { text: inventory.customerMessage(result) });
    await send(sock, to, `✅ Order #${session.payload.orderId} selesai dan data dikirim ke customer.`);
    return sendAdminMenu(sock, to);
  }
}

module.exports = {
  handleAdminMessage,
  isAdminSessionActive
};
