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
const SPECIAL_STEPS = new Set([
  'order_confirm',
  'order_payment',
  'isi_saldo',
  'topup_payment',
  'settings_name',
  'settings_email',
  'settings_rekening'
]);

function newState() {
  return { active: false, step: 'idle', expiresAt: 0 };
}

function getState(phone) {
  if (!userStates.has(phone)) userStates.set(phone, newState());
  const state = userStates.get(phone);
  if (state.active && state.expiresAt <= Date.now()) {
    userStates.set(phone, newState());
    return userStates.get(phone);
  }
  return state;
}

function setState(phone, patch = {}) {
  const current = getState(phone);
  const next = {
    ...current,
    ...patch,
    expiresAt: patch.active === false ? 0 : Date.now() + SESSION_MS
  };
  userStates.set(phone, next);
  return next;
}

function activate(phone, step = 'menu', extra = {}) {
  return setState(phone, { active: true, step, ...extra });
}

function deactivate(phone) {
  userStates.set(phone, newState());
}

function touch(phone) {
  const state = getState(phone);
  if (state.active) state.expiresAt = Date.now() + SESSION_MS;
  return state;
}

function unwrapMessage(message = {}) {
  let current = message;
  for (let i = 0; i < 5; i += 1) {
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

  if (message.conversation) return { type, text: message.conversation.trim() };
  if (message.extendedTextMessage?.text) return { type, text: message.extendedTextMessage.text.trim() };
  if (message.imageMessage?.caption) return { type, text: message.imageMessage.caption.trim() };
  if (message.videoMessage?.caption) return { type, text: message.videoMessage.caption.trim() };

  const rowId = message.listResponseMessage?.singleSelectReply?.selectedRowId;
  if (rowId) return { type, action: rowId };

  const buttonId = message.buttonsResponseMessage?.selectedButtonId;
  if (buttonId) return { type, action: buttonId };

  const templateId = message.templateButtonReplyMessage?.selectedId;
  if (templateId) return { type, action: templateId };

  const paramsJson = message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (paramsJson) {
    try {
      const params = JSON.parse(paramsJson);
      const id = params.id || params.row_id || params.selected_id || params.button_id;
      if (id) return { type, action: id };
    } catch (error) {
      console.error('[INTERACTIVE RESPONSE PARSE]', error.message);
    }
  }

  return { type };
}

function ensureUser(phone, pushName = '') {
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    db.prepare('INSERT INTO users (phone, name) VALUES (?, ?)').run(phone, pushName || '');
    user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  } else if (!user.name && pushName) {
    db.prepare('UPDATE users SET name=? WHERE phone=?').run(pushName, phone);
    user.name = pushName;
  }
  return user;
}

function readQris() {
  if (!fs.existsSync(QRIS_PATH)) {
    throw new Error(`File QRIS tidak ditemukan: ${QRIS_PATH}`);
  }
  return fs.readFileSync(QRIS_PATH);
}

async function handleMessage(sock, msg) {
  const from = msg.key.remoteJid;
  if (!from || from === 'status@broadcast' || from.includes('@g.us')) return;

  // Balas ke JID asli supaya chat @lid tetap berfungsi.
  const to = from;
  const phone = from.split('@')[0];
  const parsed = parseIncoming(msg);
  const state = getState(phone);
  const rawText = parsed.text || '';
  const normalized = rawText.toLowerCase();

  console.log(`[MSG] ${phone} type=${parsed.type} action=${parsed.action || '-'} text=${rawText || '-'}`);

  // Command start/stop diproses sebelum registrasi supaya chat pribadi biasa tetap bersih.
  if (START_COMMANDS.has(normalized)) {
    ensureUser(phone, msg.pushName || '');
    activate(phone, 'menu');
    return menu.sendMainMenu(sock, to);
  }

  if (STOP_COMMANDS.has(normalized)) {
    deactivate(phone);
    return sock.sendMessage(to, {
      text: '⏹️ Bot dinonaktifkan untuk chat ini. Pesan berikutnya tidak akan dibalas bot. Kirim *#mulai* untuk membukanya lagi.'
    });
  }

  // Chat biasa diabaikan total bila sesi bot belum aktif.
  if (!state.active) {
    if (parsed.action) {
      return sock.sendMessage(to, { text: 'Sesi menu sudah berakhir. Kirim *#mulai* untuk membuka menu baru.' });
    }
    return;
  }

  ensureUser(phone, msg.pushName || '');
  touch(phone);

  if (parsed.action) {
    if (SPECIAL_STEPS.has(state.step)) {
      return handleState(sock, to, phone, state, parsed.action);
    }
    return handleListAction(sock, to, phone, parsed.action);
  }

  if (!rawText) return;

  // Admin command dari pesan masuk tetap dibatasi ke nomor owner.
  if (phone === OWNER_PHONE && rawText.startsWith('/')) {
    const { handleAdminCommand } = require('./admin');
    return handleAdminCommand(sock, msg);
  }

  if (SPECIAL_STEPS.has(state.step)) {
    return handleState(sock, to, phone, state, rawText);
  }

  const actions = [
    'profile', 'list_produk', 'kategori', 'stock', 'isi_saldo',
    'order_history', 'customer_service', 'settings', 'kembali_menu',
    'set_nama', 'set_email', 'set_rekening', 'stop_bot'
  ];

  if (
    actions.includes(normalized) ||
    normalized.startsWith('order_') ||
    normalized.startsWith('lanjut_') ||
    normalized.startsWith('kategori_')
  ) {
    return handleListAction(sock, to, phone, normalized);
  }

  return sock.sendMessage(to, {
    text: `Saya tidak mengenali pilihan itu. Gunakan tombol/list menu, kirim *#menu*, atau *#stop* untuk menutup bot.`
  });
}

async function handleListAction(sock, from, phone, rowId) {
  touch(phone);

  if (rowId === 'stop_bot') {
    deactivate(phone);
    return sock.sendMessage(from, {
      text: '⏹️ Bot telah ditutup. Chat berikutnya akan menjadi percakapan biasa dengan admin. Kirim *#mulai* untuk membuka bot kembali.'
    });
  }

  if (rowId === 'kembali_menu') {
    activate(phone, 'menu');
    return menu.sendMainMenu(sock, from);
  }
  if (rowId === 'profile') return menu.sendProfile(sock, from, phone);
  if (rowId === 'list_produk') return menu.sendProductList(sock, from, 1);
  if (rowId === 'kategori') return menu.sendCategoryList(sock, from);
  if (rowId === 'stock') return menu.sendStockList(sock, from);

  if (rowId === 'isi_saldo') {
    activate(phone, 'isi_saldo');
    return sock.sendMessage(from, { text: '💰 Masukkan nominal top up, contoh: *50000*\nKetik *batal* untuk kembali.' });
  }

  if (rowId === 'order_history') return menu.sendOrderHistory(sock, from, phone);

  if (rowId === 'customer_service') {
    deactivate(phone);
    await menu.sendCustomerService(sock, from);
    return sock.sendMessage(`${OWNER_PHONE}@s.whatsapp.net`, {
      text: `🔔 Permintaan Customer Service dari ${phone}. Bot sudah dinonaktifkan untuk chat tersebut.`
    });
  }

  if (rowId === 'settings') return menu.sendSettings(sock, from);

  if (rowId === 'set_nama') {
    activate(phone, 'settings_name');
    return sock.sendMessage(from, { text: '✏️ Masukkan nama baru:' });
  }
  if (rowId === 'set_email') {
    activate(phone, 'settings_email');
    return sock.sendMessage(from, { text: '📧 Masukkan email baru:' });
  }
  if (rowId === 'set_rekening') {
    activate(phone, 'settings_rekening');
    return sock.sendMessage(from, { text: '💳 Masukkan nomor rekening baru:' });
  }

  if (rowId.startsWith('order_')) {
    const productId = Number.parseInt(rowId.split('_')[1], 10);
    return initiateOrder(sock, from, phone, productId);
  }
  if (rowId.startsWith('lanjut_')) {
    const page = Number.parseInt(rowId.split('_')[1], 10);
    return menu.sendProductList(sock, from, page);
  }
  if (rowId.startsWith('kategori_')) {
    const encoded = rowId.substring(9);
    let category = encoded;
    try { category = decodeURIComponent(encoded); } catch (_) {}
    return menu.sendCategoryProducts(sock, from, category);
  }

  return menu.sendMainMenu(sock, from);
}

async function handleState(sock, from, phone, state, input) {
  const raw = String(input || '').trim();
  const normalized = raw.toLowerCase();

  if (normalized === 'kembali_menu') {
    activate(phone, 'menu');
    return menu.sendMainMenu(sock, from);
  }

  if (normalized === 'customer_service') {
    deactivate(phone);
    await menu.sendCustomerService(sock, from);
    return sock.sendMessage(`${OWNER_PHONE}@s.whatsapp.net`, {
      text: `🔔 Permintaan Customer Service dari ${phone}. Bot sudah dinonaktifkan untuk chat tersebut.`
    });
  }

  if (state.step === 'isi_saldo') {
    if (['batal', 'cancel_payment'].includes(normalized)) {
      activate(phone, 'menu');
      return menu.sendMainMenu(sock, from);
    }

    const nominal = Number.parseInt(raw.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(nominal) || nominal < 1000) {
      return sock.sendMessage(from, { text: '❌ Nominal tidak valid. Minimal Rp1.000.' });
    }

    activate(phone, 'topup_payment', { nominal });
    try {
      await sock.sendMessage(from, {
        image: readQris(),
        caption: `💳 *TOP UP SALDO*\nNominal: Rp ${nominal.toLocaleString('id-ID')}\n\nScan QRIS lalu tekan *Sudah Bayar*.`
      });
      return menu.sendPaymentActions(sock, from, 'topup');
    } catch (error) {
      console.error('[QRIS ERROR]', error.message);
      return sock.sendMessage(from, { text: '❌ QRIS belum tersedia. Hubungi customer service.' });
    }
  }

  if (state.step === 'topup_payment') {
    if (['topup_paid', 'sudah bayar'].includes(normalized)) {
      await sock.sendMessage(`${OWNER_PHONE}@s.whatsapp.net`, {
        text: `🔔 Top Up dari ${phone} sebesar Rp ${Number(state.nominal).toLocaleString('id-ID')}\nGunakan self-chat admin: /topup ${phone} ${state.nominal}`
      });
      await sock.sendMessage(from, { text: '✅ Permintaan top up telah dikirim ke admin untuk diverifikasi.' });
      activate(phone, 'menu');
      return menu.sendMainMenu(sock, from);
    }
    if (['cancel_payment', 'batal'].includes(normalized)) {
      activate(phone, 'menu');
      return menu.sendMainMenu(sock, from);
    }
    return menu.sendPaymentActions(sock, from, 'topup');
  }

  if (state.step === 'order_confirm') {
    if (['confirm_order', 'ya', 'lanjut'].includes(normalized)) {
      const product = db.prepare('SELECT * FROM products WHERE id=? AND is_active=1').get(state.productId);
      if (!product) {
        activate(phone, 'menu');
        return sock.sendMessage(from, { text: '❌ Produk tidak ditemukan atau sudah nonaktif.' });
      }

      const stock = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE product_id=? AND is_sold=0').get(state.productId).cnt;
      if (stock < 1) {
        activate(phone, 'menu');
        return sock.sendMessage(from, { text: '❌ Stok habis.' });
      }

      const result = db.prepare('INSERT INTO orders (user_phone, product_id, amount, status) VALUES (?,?,?,?)')
        .run(phone, state.productId, product.price, 'pending');
      const orderId = result.lastInsertRowid;
      activate(phone, 'order_payment', { orderId, productId: state.productId });

      try {
        await sock.sendMessage(from, {
          image: readQris(),
          caption: `💳 *PEMBAYARAN ORDER*\nOrder: #${orderId}\nProduk: ${product.name}\nTotal: Rp ${Number(product.price).toLocaleString('id-ID')}\n\nScan QRIS lalu tekan *Sudah Bayar*.`
        });
        return menu.sendPaymentActions(sock, from, 'order');
      } catch (error) {
        console.error('[QRIS ERROR]', error.message);
        return sock.sendMessage(from, { text: '❌ QRIS belum tersedia. Hubungi customer service.' });
      }
    }

    if (['cancel_order', 'batal'].includes(normalized)) {
      activate(phone, 'menu');
      return menu.sendMainMenu(sock, from);
    }

    const product = db.prepare('SELECT * FROM products WHERE id=?').get(state.productId);
    const stock = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE product_id=? AND is_sold=0').get(state.productId).cnt;
    return menu.sendOrderConfirmation(sock, from, product, stock);
  }

  if (state.step === 'order_payment') {
    if (['order_paid', 'sudah bayar'].includes(normalized)) {
      await sock.sendMessage(`${OWNER_PHONE}@s.whatsapp.net`, {
        text: `🔔 Pembayaran Order #${state.orderId} dari ${phone}\nGunakan self-chat admin: /verifikasi ${state.orderId}`
      });
      await sock.sendMessage(from, { text: '✅ Pembayaran diteruskan ke admin. Menunggu verifikasi.' });
      activate(phone, 'menu');
      return menu.sendMainMenu(sock, from);
    }

    if (['cancel_payment', 'batal'].includes(normalized)) {
      db.prepare("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'").run(state.orderId);
      activate(phone, 'menu');
      return menu.sendMainMenu(sock, from);
    }

    return menu.sendPaymentActions(sock, from, 'order');
  }

  if (state.step === 'settings_name') {
    if (!raw || raw.length > 80) return sock.sendMessage(from, { text: '❌ Nama tidak valid.' });
    db.prepare('UPDATE users SET name=? WHERE phone=?').run(raw, phone);
    activate(phone, 'menu');
    await sock.sendMessage(from, { text: '✅ Nama berhasil diubah.' });
    return menu.sendProfile(sock, from, phone);
  }

  if (state.step === 'settings_email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      return sock.sendMessage(from, { text: '❌ Format email tidak valid.' });
    }
    db.prepare('UPDATE users SET email=? WHERE phone=?').run(raw.toLowerCase(), phone);
    activate(phone, 'menu');
    await sock.sendMessage(from, { text: '✅ Email berhasil diubah.' });
    return menu.sendProfile(sock, from, phone);
  }

  if (state.step === 'settings_rekening') {
    if (!raw || raw.length > 100) return sock.sendMessage(from, { text: '❌ Nomor rekening tidak valid.' });
    db.prepare('UPDATE users SET no_rekening=? WHERE phone=?').run(raw, phone);
    activate(phone, 'menu');
    await sock.sendMessage(from, { text: '✅ Nomor rekening berhasil diubah.' });
    return menu.sendProfile(sock, from, phone);
  }
}

async function initiateOrder(sock, from, phone, productId) {
  if (!Number.isInteger(productId)) return sock.sendMessage(from, { text: '❌ ID produk tidak valid.' });

  const product = db.prepare('SELECT * FROM products WHERE id=? AND is_active=1').get(productId);
  if (!product) return sock.sendMessage(from, { text: '❌ Produk tidak ditemukan.' });

  const stock = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE product_id=? AND is_sold=0').get(productId).cnt;
  if (stock < 1) return sock.sendMessage(from, { text: '❌ Stok produk sedang habis.' });

  activate(phone, 'order_confirm', { productId });
  return menu.sendOrderConfirmation(sock, from, product, stock);
}

module.exports = handleMessage;
module.exports.parseIncoming = parseIncoming;
