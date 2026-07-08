const fs = require('fs');
const path = require('path');
const db = require('./database');
const menu = require('./menu');
const { resolveChatIdentity, getOwnerJid, extractText } = require('./message-utils');

const START_COMMANDS = new Set(['/mulai', '#mulai', '/menu', '#menu']);
const STOP_COMMANDS = new Set(['/stop', '#stop']);
const OWNER_PHONE = String(process.env.OWNER_PHONE || '6285727688928').replace(/\D/g, '');
const SESSION_MINUTES = Math.max(5, Number(process.env.BOT_SESSION_MINUTES || 60));
const QRIS_PATH = path.resolve(process.env.QRIS_PATH || path.join(__dirname, 'qris.jpg'));

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function parsePayload(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (_) {
    return {};
  }
}

function getSession(userKey) {
  const row = db.prepare('SELECT * FROM bot_sessions WHERE user_key=?').get(userKey);
  if (!row) return { active: false, step: 'idle', payload: {}, reply_jid: '' };

  if (row.active && Number(row.expires_at) < nowSeconds()) {
    db.prepare(`UPDATE bot_sessions SET active=0, step='idle', payload='{}', updated_at=CURRENT_TIMESTAMP WHERE user_key=?`)
      .run(userKey);
    return { active: false, step: 'idle', payload: {}, reply_jid: row.reply_jid };
  }

  return {
    active: Boolean(row.active),
    step: row.step,
    payload: parsePayload(row.payload),
    reply_jid: row.reply_jid,
    expires_at: row.expires_at
  };
}

function saveSession(userKey, replyJid, active, step, payload = {}) {
  const expiresAt = active ? nowSeconds() + (SESSION_MINUTES * 60) : 0;
  db.prepare(`
    INSERT INTO bot_sessions (user_key, reply_jid, active, step, payload, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_key) DO UPDATE SET
      reply_jid=excluded.reply_jid,
      active=excluded.active,
      step=excluded.step,
      payload=excluded.payload,
      expires_at=excluded.expires_at,
      updated_at=CURRENT_TIMESTAMP
  `).run(userKey, replyJid, active ? 1 : 0, step, JSON.stringify(payload || {}), expiresAt);
}

function activate(userKey, replyJid, step = 'main', payload = {}) {
  saveSession(userKey, replyJid, true, step, payload);
}

function deactivate(userKey, replyJid) {
  saveSession(userKey, replyJid, false, 'idle', {});
}

function ensureUser(userKey, pushName = '') {
  const existing = db.prepare('SELECT * FROM users WHERE phone=?').get(userKey);
  if (!existing) {
    db.prepare('INSERT INTO users (phone, name) VALUES (?, ?)').run(userKey, pushName || '');
    return db.prepare('SELECT * FROM users WHERE phone=?').get(userKey);
  }
  if (!existing.name && pushName) {
    db.prepare('UPDATE users SET name=? WHERE phone=?').run(pushName, userKey);
    existing.name = pushName;
  }
  return existing;
}

function markMessageProcessed(messageId) {
  if (!messageId) return true;
  const result = db.prepare('INSERT OR IGNORE INTO message_events (message_id) VALUES (?)').run(messageId);
  return result.changes === 1;
}

function getChoice(text) {
  const value = String(text || '').trim();
  if (!/^\d{1,2}$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

function readQris() {
  if (!fs.existsSync(QRIS_PATH)) throw new Error(`File QRIS tidak ditemukan: ${QRIS_PATH}`);
  return fs.readFileSync(QRIS_PATH);
}

async function notifyOwner(sock, text) {
  try {
    const result = await sock.sendMessage(getOwnerJid(sock), { text });
    console.log(`[OWNER OUT] id=${result?.key?.id || '-'}`);
  } catch (error) {
    console.error('[OWNER NOTIFICATION]', error?.message || error);
  }
}

async function openCustomerService(sock, to, userKey) {
  deactivate(userKey, to);
  await menu.sendCustomerService(sock, to);
  await notifyOwner(sock, `🔔 Permintaan Customer Service dari ${userKey}. Bot telah dinonaktifkan untuk chat tersebut.`);
}

async function sendQrisAndMenu(sock, to, type, data) {
  try {
    const caption = type === 'order'
      ? `💳 *QRIS PEMBAYARAN*\nOrder: #${data.orderId}\nProduk: ${data.productName}\nTotal: Rp ${Number(data.amount).toLocaleString('id-ID')}`
      : `💳 *QRIS TOP UP*\nNominal: Rp ${Number(data.amount).toLocaleString('id-ID')}`;

    await sock.sendMessage(to, { image: readQris(), caption });
    return menu.sendPaymentMenu(sock, to, type, data);
  } catch (error) {
    console.error('[QRIS ERROR]', error?.message || error);
    return menu.sendText(sock, to,
`❌ *QRIS BELUM TERSEDIA*

File QRIS tidak ditemukan atau gagal dikirim.

9. 💬 Customer Service
0. 🏠 Menu Utama`);
  }
}

async function handleMain(sock, to, userKey, choice) {
  if (choice === 1) {
    activate(userKey, to, 'profile');
    return menu.sendProfile(sock, to, userKey);
  }
  if (choice === 2) {
    const pageData = await menu.sendProductList(sock, to, 1);
    activate(userKey, to, 'products', {
      page: pageData.page,
      productIds: pageData.products.map((item) => item.id)
    });
    return;
  }
  if (choice === 3) {
    const data = await menu.sendCategoryList(sock, to, 1);
    activate(userKey, to, 'category_list', {
      page: data.page,
      totalPages: data.totalPages,
      categories: data.categories.map((item) => item.category)
    });
    return;
  }
  if (choice === 4) {
    const data = await menu.sendStockList(sock, to, 1);
    activate(userKey, to, 'stock', data);
    return;
  }
  if (choice === 5) {
    activate(userKey, to, 'topup_select');
    return menu.sendTopupMenu(sock, to);
  }
  if (choice === 6) {
    activate(userKey, to, 'order_history');
    return menu.sendOrderHistory(sock, to, userKey);
  }
  if (choice === 7) {
    const data = await menu.sendTopOrder(sock, to);
    activate(userKey, to, 'top_order', {
      productIds: data.products.map((item) => item.id)
    });
    return;
  }
  if (choice === 8) {
    activate(userKey, to, 'settings');
    return menu.sendSettings(sock, to);
  }
  if (choice === 9) return openCustomerService(sock, to, userKey);
  if (choice === 0) {
    deactivate(userKey, to);
    return menu.sendStopped(sock, to);
  }
}

async function openProducts(sock, to, userKey, page = 1, category = null) {
  const data = await menu.sendProductList(sock, to, page, category);
  activate(userKey, to, category ? 'category_products' : 'products', {
    page: data.page,
    category,
    productIds: data.products.map((item) => item.id),
    totalPages: data.totalPages
  });
}

async function handleProducts(sock, to, userKey, choice, session, isCategory = false) {
  const { page = 1, productIds = [], category = null, totalPages = 1 } = session.payload;

  if (choice >= 1 && choice <= 5 && productIds[choice - 1]) {
    const productId = productIds[choice - 1];
    const product = await menu.sendProductDetail(sock, to, productId);
    if (!product) return;
    activate(userKey, to, 'product_detail', {
      productId,
      returnStep: isCategory ? 'category_products' : 'products',
      returnPage: page,
      category
    });
    return;
  }

  if (choice === 6 && page < totalPages) return openProducts(sock, to, userKey, page + 1, category);
  if (choice === 7 && page > 1) return openProducts(sock, to, userKey, page - 1, category);

  if (choice === 8) {
    if (isCategory) {
      const data = await menu.sendCategoryList(sock, to, 1);
      activate(userKey, to, 'category_list', {
        page: data.page,
        totalPages: data.totalPages,
        categories: data.categories.map((item) => item.category)
      });
      return;
    }
    const data = await menu.sendStockList(sock, to, 1);
    activate(userKey, to, 'stock', data);
    return;
  }

  if (choice === 9) {
    if (isCategory) return openProducts(sock, to, userKey, 1, null);
    const data = await menu.sendCategoryList(sock, to, 1);
    activate(userKey, to, 'category_list', {
      page: data.page,
      totalPages: data.totalPages,
      categories: data.categories.map((item) => item.category)
    });
    return;
  }

  if (choice === 0) {
    const user = ensureUser(userKey);
    activate(userKey, to, 'main');
    return menu.sendMainMenu(sock, to, user.name);
  }
}

async function handleCategoryList(sock, to, userKey, choice, session) {
  const { page = 1, totalPages = 1, categories = [] } = session.payload;

  if (choice >= 1 && choice <= 7 && categories[choice - 1]) {
    return openProducts(sock, to, userKey, 1, categories[choice - 1]);
  }

  if (choice === 8 && page < totalPages) {
    const data = await menu.sendCategoryList(sock, to, page + 1);
    if (data.page === page && !data.categories.length) return;
    activate(userKey, to, 'category_list', {
      page: data.page,
      totalPages: data.totalPages,
      categories: data.categories.map((item) => item.category)
    });
    return;
  }

  if (choice === 9 && page > 1) {
    const data = await menu.sendCategoryList(sock, to, page - 1);
    activate(userKey, to, 'category_list', {
      page: data.page,
      totalPages: data.totalPages,
      categories: data.categories.map((item) => item.category)
    });
    return;
  }

  if (choice === 0) {
    const user = ensureUser(userKey);
    activate(userKey, to, 'main');
    return menu.sendMainMenu(sock, to, user.name);
  }
}

async function returnToProductSource(sock, to, userKey, payload = {}) {
  if (payload.returnStep === 'top_order') {
    const data = await menu.sendTopOrder(sock, to);
    activate(userKey, to, 'top_order', {
      productIds: data.products.map((item) => item.id)
    });
    return;
  }
  return openProducts(sock, to, userKey, payload.returnPage || 1, payload.category || null);
}

async function handleProductDetail(sock, to, userKey, choice, session) {
  const payload = session.payload;
  if (choice === 1) {
    const product = db.prepare('SELECT * FROM products WHERE id=? AND is_active=1').get(payload.productId);
    if (!product) return;
    const stock = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE product_id=? AND is_sold=0')
      .get(payload.productId).cnt;
    if (stock < 1) {
      return menu.sendText(sock, to,
`❌ *STOCK HABIS*

Produk ini sedang tidak tersedia.

2. 📦 Kembali ke Produk
9. 💬 Customer Service
0. 🏠 Menu Utama`);
    }
    activate(userKey, to, 'order_confirm', payload);
    return menu.sendOrderConfirmation(sock, to, product, stock);
  }
  if (choice === 2) return returnToProductSource(sock, to, userKey, payload);
  if (choice === 9) return openCustomerService(sock, to, userKey);
  if (choice === 0) {
    const user = ensureUser(userKey);
    activate(userKey, to, 'main');
    return menu.sendMainMenu(sock, to, user.name);
  }
}

async function handleOrderConfirm(sock, to, userKey, choice, session) {
  if (choice === 1) {
    const productId = session.payload.productId;
    const product = db.prepare('SELECT * FROM products WHERE id=? AND is_active=1').get(productId);
    if (!product) return;
    const stock = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE product_id=? AND is_sold=0')
      .get(productId).cnt;
    if (stock < 1) return menu.sendText(sock, to, '❌ Stock baru saja habis. Balas *0* untuk kembali ke menu utama.');

    const result = db.prepare(`
      INSERT INTO orders (user_phone, product_id, amount, status)
      VALUES (?, ?, ?, 'pending')
    `).run(userKey, productId, product.price);

    const orderId = Number(result.lastInsertRowid);
    activate(userKey, to, 'order_payment', {
      orderId,
      productId,
      amount: Number(product.price),
      productName: product.name
    });
    return sendQrisAndMenu(sock, to, 'order', {
      orderId,
      amount: Number(product.price),
      productName: product.name
    });
  }

  if (choice === 2) return returnToProductSource(sock, to, userKey, session.payload);
  if (choice === 0) {
    const user = ensureUser(userKey);
    activate(userKey, to, 'main');
    return menu.sendMainMenu(sock, to, user.name);
  }
}

async function handleTopupSelect(sock, to, userKey, choice) {
  const amounts = { 1: 10000, 2: 20000, 3: 50000, 4: 100000, 5: 200000, 6: 500000 };
  if (amounts[choice]) {
    activate(userKey, to, 'topup_payment', { amount: amounts[choice] });
    return sendQrisAndMenu(sock, to, 'topup', { amount: amounts[choice] });
  }
  if (choice === 0) {
    const user = ensureUser(userKey);
    activate(userKey, to, 'main');
    return menu.sendMainMenu(sock, to, user.name);
  }
}

async function handlePayment(sock, to, userKey, choice, session, type) {
  if (choice === 1) {
    if (type === 'order') {
      await notifyOwner(sock,
        `🔔 Pembayaran Order #${session.payload.orderId} dari ${userKey}\nGunakan command: /verifikasi ${session.payload.orderId}`);
    } else {
      await notifyOwner(sock,
        `🔔 Top Up dari ${userKey} sebesar Rp ${Number(session.payload.amount).toLocaleString('id-ID')}\nGunakan command: /topup ${userKey} ${session.payload.amount}`);
    }
    activate(userKey, to, 'post_submit', { type });
    return menu.sendSubmissionReceived(sock, to, type);
  }

  if (choice === 2) {
    if (type === 'order' && session.payload.orderId) {
      db.prepare("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'")
        .run(session.payload.orderId);
    }
    const user = ensureUser(userKey);
    activate(userKey, to, 'main');
    return menu.sendMainMenu(sock, to, user.name);
  }

  if (choice === 9) return openCustomerService(sock, to, userKey);
  if (choice === 0) {
    const user = ensureUser(userKey);
    activate(userKey, to, 'main');
    return menu.sendMainMenu(sock, to, user.name);
  }
}

async function routeChoice(sock, to, userKey, choice, session) {
  if (session.step === 'main') return handleMain(sock, to, userKey, choice);

  if (session.step === 'profile') {
    if (choice === 1) {
      activate(userKey, to, 'topup_select');
      return menu.sendTopupMenu(sock, to);
    }
    if (choice === 2) {
      activate(userKey, to, 'order_history');
      return menu.sendOrderHistory(sock, to, userKey);
    }
    if (choice === 3) {
      activate(userKey, to, 'settings');
      return menu.sendSettings(sock, to);
    }
    if (choice === 4) return openProducts(sock, to, userKey, 1);
    if (choice === 9) return openCustomerService(sock, to, userKey);
  }

  if (session.step === 'products') return handleProducts(sock, to, userKey, choice, session, false);
  if (session.step === 'category_products') return handleProducts(sock, to, userKey, choice, session, true);
  if (session.step === 'category_list') return handleCategoryList(sock, to, userKey, choice, session);
  if (session.step === 'product_detail') return handleProductDetail(sock, to, userKey, choice, session);
  if (session.step === 'order_confirm') return handleOrderConfirm(sock, to, userKey, choice, session);
  if (session.step === 'topup_select') return handleTopupSelect(sock, to, userKey, choice);
  if (session.step === 'order_payment') return handlePayment(sock, to, userKey, choice, session, 'order');
  if (session.step === 'topup_payment') return handlePayment(sock, to, userKey, choice, session, 'topup');

  if (session.step === 'stock') {
    const { page = 1, totalPages = 1 } = session.payload;
    if (choice === 1 && page < totalPages) {
      const data = await menu.sendStockList(sock, to, page + 1);
      activate(userKey, to, 'stock', data);
      return;
    }
    if (choice === 2 && page > 1) {
      const data = await menu.sendStockList(sock, to, page - 1);
      activate(userKey, to, 'stock', data);
      return;
    }
    if (choice === 3) return openProducts(sock, to, userKey, 1);
    if (choice === 4) {
      const data = await menu.sendCategoryList(sock, to, 1);
      activate(userKey, to, 'category_list', {
        page: data.page,
        totalPages: data.totalPages,
        categories: data.categories.map((item) => item.category)
      });
      return;
    }
  }

  if (session.step === 'order_history') {
    if (choice === 1) return openProducts(sock, to, userKey, 1);
    if (choice === 2) {
      activate(userKey, to, 'topup_select');
      return menu.sendTopupMenu(sock, to);
    }
    if (choice === 9) return openCustomerService(sock, to, userKey);
  }

  if (session.step === 'top_order') {
    const productIds = session.payload.productIds || [];
    if (choice >= 1 && choice <= 5 && productIds[choice - 1]) {
      const productId = productIds[choice - 1];
      const product = await menu.sendProductDetail(sock, to, productId);
      if (!product) return;
      activate(userKey, to, 'product_detail', {
        productId,
        returnStep: 'top_order'
      });
      return;
    }
    if (choice === 8) return openProducts(sock, to, userKey, 1);
    if (choice === 9) {
      const data = await menu.sendCategoryList(sock, to, 1);
      activate(userKey, to, 'category_list', {
        page: data.page,
        totalPages: data.totalPages,
        categories: data.categories.map((item) => item.category)
      });
      return;
    }
  }

  if (session.step === 'settings') {
    if (choice === 1) {
      activate(userKey, to, 'profile');
      return menu.sendProfile(sock, to, userKey);
    }
    if (choice === 2) return openCustomerService(sock, to, userKey);
    if (choice === 3) {
      activate(userKey, to, 'security_info');
      return menu.sendSecurityInfo(sock, to);
    }
  }

  if (session.step === 'security_info') {
    if (choice === 1) {
      activate(userKey, to, 'settings');
      return menu.sendSettings(sock, to);
    }
    if (choice === 9) return openCustomerService(sock, to, userKey);
  }

  if (session.step === 'post_submit') {
    if (choice === 1) {
      const user = ensureUser(userKey);
      activate(userKey, to, 'main');
      return menu.sendMainMenu(sock, to, user.name);
    }
    if (choice === 2) {
      activate(userKey, to, 'order_history');
      return menu.sendOrderHistory(sock, to, userKey);
    }
    if (choice === 9) return openCustomerService(sock, to, userKey);
    if (choice === 0) {
      deactivate(userKey, to);
      return menu.sendStopped(sock, to);
    }
  }

  // Pilihan 0 berlaku di semua halaman yang belum ditangani khusus.
  if (choice === 0) {
    const user = ensureUser(userKey);
    activate(userKey, to, 'main');
    return menu.sendMainMenu(sock, to, user.name);
  }

  // Nomor yang tidak tersedia sengaja tidak dibalas.
}

async function handleMessage(sock, msg) {
  const remote = msg.key?.remoteJid;
  if (!remote || remote === 'status@broadcast' || remote.includes('@g.us')) return;
  if (!markMessageProcessed(msg.key?.id)) return;

  const { replyJid: to, userKey, displayPhone } = await resolveChatIdentity(sock, msg);
  const text = extractText(msg);
  const normalized = text.toLowerCase();

  console.log(`[MSG] user=${userKey} display=${displayPhone} reply=${to} text=${text || '-'}`);

  if (START_COMMANDS.has(normalized)) {
    const user = ensureUser(userKey, msg.pushName || '');
    activate(userKey, to, 'main');
    return menu.sendMainMenu(sock, to, user.name);
  }

  if (STOP_COMMANDS.has(normalized)) {
    deactivate(userKey, to);
    return menu.sendStopped(sock, to);
  }

  const session = getSession(userKey);
  if (!session.active) return;

  const choice = getChoice(text);
  if (choice === null) return;

  // Perbarui reply JID dan masa berlaku sebelum memproses pilihan.
  activate(userKey, to, session.step, session.payload);
  return routeChoice(sock, to, userKey, choice, getSession(userKey));
}

module.exports = handleMessage;
