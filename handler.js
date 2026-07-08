const db = require('./database');
const menu = require('./menu');
const fs = require('fs');
const path = require('path');

const userStates = new Map();
const OWNER_PHONE = process.env.OWNER_PHONE || '6285727688928';
const SESSION_MINUTES = Math.max(5, Number(process.env.BOT_SESSION_MINUTES || 30));
const SESSION_MS = SESSION_MINUTES * 60 * 1000;
const QRIS_PATH = path.resolve(process.env.QRIS_PATH || path.join(__dirname, 'qris.jpg'));

const START_COMMANDS = new Set(['/mulai', '#mulai', '/menu', '#menu']);
const STOP_COMMANDS = new Set(['/stop', '#stop', '/selesai', '#selesai']);

function newState() {
  return { active: false, step: 'idle', expiresAt: 0 };
}

function getState(accountKey) {
  if (!userStates.has(accountKey)) userStates.set(accountKey, newState());
  const state = userStates.get(accountKey);
  if (state.active && state.expiresAt <= Date.now()) {
    userStates.set(accountKey, newState());
    return userStates.get(accountKey);
  }
  return state;
}

function setState(accountKey, patch = {}) {
  const current = getState(accountKey);
  const next = {
    ...current,
    ...patch,
    expiresAt: patch.active === false ? 0 : Date.now() + SESSION_MS
  };
  userStates.set(accountKey, next);
  return next;
}

function activate(accountKey, step = 'menu', extra = {}) {
  return setState(accountKey, { active: true, step, ...extra });
}

function deactivate(accountKey) {
  userStates.set(accountKey, newState());
}

function touch(accountKey) {
  const state = getState(accountKey);
  if (state.active) state.expiresAt = Date.now() + SESSION_MS;
  return state;
}

function unwrapMessage(message = {}) {
  let current = message;
  for (let index = 0; index < 6; index += 1) {
    if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
    else if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
    else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
    else if (current.documentWithCaptionMessage?.message) current = current.documentWithCaptionMessage.message;
    else break;
  }
  return current;
}

function parseIncoming(msg) {
  const message = unwrapMessage(msg.message || {});
  const type = Object.keys(message)[0] || 'unknown';

  const text = (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  ).trim();
  if (text) return { type, text };

  const listId = message.listResponseMessage?.singleSelectReply?.selectedRowId;
  if (listId) return { type, action: listId };

  const buttonId = message.buttonsResponseMessage?.selectedButtonId;
  if (buttonId) return { type, action: buttonId };

  const templateId = message.templateButtonReplyMessage?.selectedId;
  if (templateId) return { type, action: templateId };

  const paramsJson = message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (paramsJson) {
    try {
      const params = JSON.parse(paramsJson);
      const id = params.id || params.row_id || params.selected_id || params.button_id;
      if (id) return { type, action: String(id) };
    } catch (error) {
      console.error('[INTERACTIVE RESPONSE PARSE]', error.message);
    }
  }

  return { type };
}

function ensureUser(accountKey, pushName = '') {
  let user = db.prepare('SELECT * FROM users WHERE phone=?').get(accountKey);
  if (!user) {
    db.prepare('INSERT INTO users (phone, name) VALUES (?, ?)').run(accountKey, pushName || '');
    user = db.prepare('SELECT * FROM users WHERE phone=?').get(accountKey);
  } else if (!user.name && pushName) {
    db.prepare('UPDATE users SET name=? WHERE phone=?').run(pushName, accountKey);
    user.name = pushName;
  }
  return user;
}

async function resolveChatIdentity(sock, msg) {
  const key = msg.key || {};
  const remote = key.remoteJid || '';
  const alt = key.remoteJidAlt || key.participantAlt || '';
  const replyJid = alt.endsWith('@s.whatsapp.net') ? alt : remote;

  let phoneJid = alt.endsWith('@s.whatsapp.net') ? alt : '';
  if (!phoneJid && remote.endsWith('@lid')) {
    try {
      phoneJid = await sock.signalRepository?.lidMapping?.getPNForLID?.(remote) || '';
    } catch (error) {
      console.warn('[LID MAP]', error?.message || error);
    }
  }

  const accountKey = phoneJid || remote;
  const displayPhone = phoneJid ? phoneJid.split('@')[0] : remote;
  return { replyJid: replyJid || remote, accountKey, displayPhone };
}

function readQris() {
  if (!fs.existsSync(QRIS_PATH)) {
    throw new Error(`File QRIS tidak ditemukan: ${QRIS_PATH}`);
  }
  return fs.readFileSync(QRIS_PATH);
}

async function notifyOwner(sock, text) {
  try {
    await sock.sendMessage(`${OWNER_PHONE}@s.whatsapp.net`, { text });
  } catch (error) {
    console.error('[OWNER NOTIFICATION]', error?.message || error);
  }
}

async function switchToCustomerService(sock, to, accountKey) {
  deactivate(accountKey);
  await menu.sendCustomerService(sock, to);
  await notifyOwner(sock, `🔔 Permintaan Customer Service dari ${accountKey}. Bot sudah dinonaktifkan untuk chat tersebut.`);
}

async function handleMessage(sock, msg) {
  const remote = msg.key.remoteJid;
  if (!remote || remote === 'status@broadcast' || remote.includes('@g.us')) return;

  const { replyJid: to, accountKey, displayPhone } = await resolveChatIdentity(sock, msg);
  const parsed = parseIncoming(msg);
  const rawText = parsed.text || '';
  const normalizedText = rawText.toLowerCase();
  const state = getState(accountKey);

  console.log(`[MSG] account=${accountKey} display=${displayPhone} reply=${to} type=${parsed.type} action=${parsed.action || '-'} text=${rawText || '-'}`);

  if (START_COMMANDS.has(normalizedText)) {
    ensureUser(accountKey, msg.pushName || '');
    activate(accountKey, 'menu');
    return menu.sendMainMenu(sock, to);
  }

  if (STOP_COMMANDS.has(normalizedText)) {
    deactivate(accountKey);
    return sock.sendMessage(to, {
      text: '⏹️ Bot dinonaktifkan. Chat berikutnya tidak akan dijawab bot. Kirim *#mulai* untuk membukanya kembali.'
    });
  }

  // Bot hanya memproses klik tombol/list selama sesi aktif.
  // Semua pesan teks lain sengaja diabaikan agar chat tetap bersih.
  if (!state.active) return;
  if (!parsed.action) return;

  ensureUser(accountKey, msg.pushName || '');
  touch(accountKey);
  return handleAction(sock, to, accountKey, parsed.action, state);
}

async function handleAction(sock, to, accountKey, action, stateSnapshot) {
  const actionId = String(action || '');
  const state = getState(accountKey);
  if (!state.active) return;

  const navigationActions = new Set([
    'profile', 'list_produk', 'more_menu', 'kategori', 'stock',
    'isi_saldo', 'order_history', 'settings'
  ]);

  if (navigationActions.has(actionId)) activate(accountKey, 'menu');

  if (actionId === 'profile') return menu.sendProfile(sock, to, accountKey);
  if (actionId === 'list_produk') return menu.sendProductList(sock, to, 1);
  if (actionId === 'more_menu') return menu.sendMoreMenu(sock, to);
  if (actionId === 'kategori') return menu.sendCategoryList(sock, to);
  if (actionId === 'stock') return menu.sendStockList(sock, to);
  if (actionId === 'isi_saldo') return menu.sendTopupAmounts(sock, to);
  if (actionId === 'order_history') return menu.sendOrderHistory(sock, to, accountKey);
  if (actionId === 'settings') return menu.sendSettings(sock, to);

  if (actionId === 'customer_service') {
    return switchToCustomerService(sock, to, accountKey);
  }

  if (actionId === 'stop_bot') {
    deactivate(accountKey);
    return sock.sendMessage(to, {
      text: '⏹️ Bot telah ditutup. Pesan berikutnya tidak akan dijawab bot. Kirim *#mulai* untuk membuka kembali.'
    });
  }

  if (actionId.startsWith('lanjut_')) {
    const page = Number.parseInt(actionId.split('_')[1], 10);
    if (Number.isInteger(page)) return menu.sendProductList(sock, to, page);
    return;
  }

  if (actionId.startsWith('kategori_')) {
    const encoded = actionId.substring(9);
    let category = encoded;
    try { category = decodeURIComponent(encoded); } catch (_) {}
    return menu.sendCategoryProducts(sock, to, category);
  }

  if (actionId.startsWith('order_')) {
    const productId = Number.parseInt(actionId.split('_')[1], 10);
    return initiateOrder(sock, to, accountKey, productId);
  }

  if (actionId.startsWith('topup_amount_')) {
    const nominal = Number.parseInt(actionId.substring('topup_amount_'.length), 10);
    if (!Number.isInteger(nominal) || nominal < 1000) return;

    activate(accountKey, 'topup_payment', { nominal });
    try {
      await sock.sendMessage(to, {
        image: readQris(),
        caption: `💳 *TOP UP SALDO*\nNominal: Rp ${nominal.toLocaleString('id-ID')}\n\nScan QRIS lalu tekan tombol *Sudah Bayar*.`
      });
      return menu.sendPaymentActions(sock, to, 'topup');
    } catch (error) {
      console.error('[QRIS ERROR]', error.message);
      activate(accountKey, 'menu');
      return menu.sendErrorActions(sock, to, '❌ QRIS belum tersedia. Silakan hubungi Customer Service.');
    }
  }

  if (actionId === 'confirm_order') {
    if (state.step !== 'order_confirm' || !Number.isInteger(state.productId)) return;

    const product = db.prepare('SELECT * FROM products WHERE id=? AND is_active=1').get(state.productId);
    if (!product) {
      activate(accountKey, 'menu');
      return menu.sendErrorActions(sock, to, '❌ Produk tidak ditemukan atau sudah nonaktif.');
    }

    const stock = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE product_id=? AND is_sold=0')
      .get(state.productId).cnt;
    if (stock < 1) {
      activate(accountKey, 'menu');
      return menu.sendErrorActions(sock, to, '❌ Stok produk sedang habis.');
    }

    const result = db.prepare('INSERT INTO orders (user_phone, product_id, amount, status) VALUES (?,?,?,?)')
      .run(accountKey, state.productId, product.price, 'pending');
    const orderId = Number(result.lastInsertRowid);
    activate(accountKey, 'order_payment', { orderId, productId: state.productId });

    try {
      await sock.sendMessage(to, {
        image: readQris(),
        caption: `💳 *PEMBAYARAN ORDER*\nOrder: #${orderId}\nProduk: ${product.name}\nTotal: Rp ${Number(product.price).toLocaleString('id-ID')}\n\nScan QRIS lalu tekan tombol *Sudah Bayar*.`
      });
      return menu.sendPaymentActions(sock, to, 'order');
    } catch (error) {
      console.error('[QRIS ERROR]', error.message);
      activate(accountKey, 'menu');
      return menu.sendErrorActions(sock, to, '❌ QRIS belum tersedia. Silakan hubungi Customer Service.');
    }
  }

  if (actionId === 'cancel_order') {
    if (state.step !== 'order_confirm') return;
    activate(accountKey, 'menu');
    return menu.sendMainMenu(sock, to);
  }

  if (actionId === 'topup_paid') {
    if (state.step !== 'topup_payment' || !Number.isInteger(state.nominal)) return;
    await notifyOwner(
      sock,
      `🔔 Top Up dari ${accountKey} sebesar Rp ${state.nominal.toLocaleString('id-ID')}\nGunakan self-chat admin: /topup ${accountKey} ${state.nominal}`
    );
    activate(accountKey, 'menu');
    return menu.sendSubmissionReceived(sock, to, 'topup');
  }

  if (actionId === 'order_paid') {
    if (state.step !== 'order_payment' || !Number.isInteger(state.orderId)) return;
    await notifyOwner(
      sock,
      `🔔 Pembayaran Order #${state.orderId} dari ${accountKey}\nGunakan self-chat admin: /verifikasi ${state.orderId}`
    );
    activate(accountKey, 'menu');
    return menu.sendSubmissionReceived(sock, to, 'order');
  }

  if (actionId === 'cancel_payment') {
    if (state.step === 'order_payment' && Number.isInteger(state.orderId)) {
      db.prepare("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'").run(state.orderId);
    }
    if (!['order_payment', 'topup_payment'].includes(state.step)) return;
    activate(accountKey, 'menu');
    return menu.sendMainMenu(sock, to);
  }

  // Tombol lama, tombol kedaluwarsa, atau action palsu tidak dibalas.
  void stateSnapshot;
}

async function initiateOrder(sock, to, accountKey, productId) {
  if (!Number.isInteger(productId)) return;

  const product = db.prepare('SELECT * FROM products WHERE id=? AND is_active=1').get(productId);
  if (!product) return menu.sendErrorActions(sock, to, '❌ Produk tidak ditemukan.');

  const stock = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE product_id=? AND is_sold=0')
    .get(productId).cnt;
  if (stock < 1) return menu.sendErrorActions(sock, to, '❌ Stok produk sedang habis.');

  activate(accountKey, 'order_confirm', { productId });
  return menu.sendOrderConfirmation(sock, to, product, stock);
}

module.exports = handleMessage;
module.exports.parseIncoming = parseIncoming;
