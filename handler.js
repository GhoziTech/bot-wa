const db = require('./database');
const menu = require('./menu');
const { readFileSync } = require('fs');
const userStates = new Map();

function getState(phone) {
  if (!userStates.has(phone)) userStates.set(phone, { step: 'idle' });
  return userStates.get(phone);
}

async function handleMessage(sock, msg) {
  const from = msg.key.remoteJid;
  // Terima semua format personal chat (termasuk @lid), tolak broadcast & grup
  if (!from || from === 'status@broadcast' || from.includes('@g.us')) return;
  const phone = from.split('@')[0];

  // Register otomatis
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    db.prepare('INSERT INTO users (phone, name) VALUES (?, ?)').run(phone, msg.pushName || '');
    user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  }

  const state = getState(phone);
  const messageType = Object.keys(msg.message || {})[0];
  let text = '';

  console.log(`[MSG] ${phone} type=${messageType}`);

  if (messageType === 'conversation') {
    text = msg.message.conversation;
  } else if (messageType === 'extendedTextMessage') {
    text = msg.message.extendedTextMessage.text;
  } else if (messageType === 'listResponseMessage') {
    const rowId = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
    console.log(`List response: ${rowId}`);
    return await handleListAction(sock, from, phone, rowId);
  } else if (messageType === 'buttonsResponseMessage') {
    const buttonId = msg.message.buttonsResponseMessage.selectedButtonId;
    console.log(`Button response: ${buttonId}`);
    return await handleListAction(sock, from, phone, buttonId);
  } else {
    console.log('Unhandled message type:', JSON.stringify(msg.message).slice(0, 200));
    return;
  }

  if (!text) return;
  text = text.trim();
  console.log(`[TEXT] ${phone}: ${text}`);

  // HANYA merespon jika user sudah dalam mode interaktif (state bukan idle) atau mengirim /mulai
  if (state.step === 'idle' && text !== '/mulai') {
    // Jika idle dan bukan /mulai, bot diam total (tidak membalas apapun)
    return;
  }

  // Jika /mulai, reset state dan tampilkan menu utama
  if (text === '/mulai') {
    userStates.set(phone, { step: 'idle' });
    return await menu.sendMainMenu(sock, from);
  }

  // Admin command (hanya untuk nomor admin)
  if (phone === '6285727688928' && text.startsWith('/')) {
    const { handleAdminCommand } = require('./admin');
    return await handleAdminCommand(sock, msg);
  }

  // State khusus (order, topup, settings)
  if (['order_confirm','order_payment','isi_saldo','topup_payment','settings_name','settings_email','settings_rekening'].includes(state.step)) {
    return await handleState(sock, from, phone, state, text.toLowerCase());
  }

  // Navigasi manual (jika user mengetik rowId seperti "profile", "list_produk", dll.)
  const actions = ['profile','list_produk','kategori','stock','isi_saldo','order_history','customer_service','settings','kembali_menu','set_nama','set_email','set_rekening'];
  if (actions.includes(text) || text.startsWith('order_') || text.startsWith('lanjut_') || text.startsWith('kategori_')) {
    return await handleListAction(sock, from, phone, text);
  }

  // Jika tidak dikenali, tetap tampilkan menu utama (biar user nggak bingung)
  await menu.sendMainMenu(sock, from);
}

// ============ HANDLE LIST ACTION ============
async function handleListAction(sock, from, phone, rowId) {
  if (rowId === 'kembali_menu') {
    userStates.set(phone, { step: 'idle' });
    return await menu.sendMainMenu(sock, from);
  }
  if (rowId === 'profile') return await menu.sendProfile(sock, from);
  if (rowId === 'list_produk') return await menu.sendProductList(sock, from, 1);
  if (rowId === 'kategori') return await menu.sendCategoryList(sock, from);
  if (rowId === 'stock') return await menu.sendStockList(sock, from);
  if (rowId === 'isi_saldo') {
    userStates.set(phone, { step: 'isi_saldo' });
    return sock.sendMessage(from, { text: '💰 Masukkan nominal top up (contoh: 50000):' });
  }
  if (rowId === 'order_history') return await menu.sendOrderHistory(sock, from);
  if (rowId === 'customer_service') return await menu.sendCustomerService(sock, from);
  if (rowId === 'settings') return await menu.sendSettings(sock, from);
  if (rowId === 'set_nama') {
    userStates.set(phone, { step: 'settings_name' });
    return sock.sendMessage(from, { text: '✏️ Masukkan nama baru:' });
  }
  if (rowId === 'set_email') {
    userStates.set(phone, { step: 'settings_email' });
    return sock.sendMessage(from, { text: '📧 Masukkan email baru:' });
  }
  if (rowId === 'set_rekening') {
    userStates.set(phone, { step: 'settings_rekening' });
    return sock.sendMessage(from, { text: '💳 Masukkan no. rekening baru:' });
  }
  if (rowId.startsWith('order_')) {
    const productId = parseInt(rowId.split('_')[1]);
    return await initiateOrder(sock, from, phone, productId);
  }
  if (rowId.startsWith('lanjut_')) {
    const page = parseInt(rowId.split('_')[1]);
    return await menu.sendProductList(sock, from, page);
  }
  if (rowId.startsWith('kategori_')) {
    const cat = rowId.substring(9);
    return await menu.sendCategoryProducts(sock, from, cat);
  }
  await menu.sendMainMenu(sock, from);
}

// ============ HANDLE STATE (ISI SALDO, ORDER, SETTINGS) ============
async function handleState(sock, from, phone, state, text) {
  if (state.step === 'isi_saldo') {
    const nominal = parseInt(text.replace(/[^0-9]/g, ''));
    if (isNaN(nominal) || nominal < 1000) return sock.sendMessage(from, { text: '❌ Nominal tidak valid.' });
    userStates.set(phone, { step: 'topup_payment', nominal });
    const qris = readFileSync('./qris.jpg');
    await sock.sendMessage(from, { image: qris, caption: `💳 Top Up Saldo Rp ${nominal.toLocaleString('id-ID')}\nScan QRIS, lalu balas *Sudah Bayar*.` });
    return;
  }
  if (state.step === 'topup_payment') {
    if (text === 'sudah bayar') {
      await sock.sendMessage('6285727688928@s.whatsapp.net', { text: `🔔 Top Up dari ${phone} Rp ${state.nominal}\nKetik /topup ${phone} ${state.nominal}` });
      await sock.sendMessage(from, { text: '✅ Permintaan top up dikirim ke admin.' });
      userStates.set(phone, { step: 'idle' });
    } else if (text === 'batal') {
      userStates.set(phone, { step: 'idle' });
      await menu.sendMainMenu(sock, from);
    }
    return;
  }
  if (state.step === 'order_confirm') {
    if (text === 'ya') {
      const product = db.prepare('SELECT * FROM products WHERE id=?').get(state.productId);
      const stock = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE product_id=? AND is_sold=0').get(state.productId).cnt;
      if (stock < 1) {
        userStates.set(phone, { step: 'idle' });
        return sock.sendMessage(from, { text: '❌ Stok habis.' });
      }
      const result = db.prepare('INSERT INTO orders (user_phone, product_id, amount, status) VALUES (?,?,?,?)').run(phone, state.productId, product.price, 'pending');
      const orderId = result.lastInsertRowid;
      userStates.set(phone, { step: 'order_payment', orderId, productId: state.productId });
      const qris = readFileSync('./qris.jpg');
      await sock.sendMessage(from, { image: qris, caption: `💳 Order #${orderId} - ${product.name}\nTotal: Rp ${product.price.toLocaleString('id-ID')}\nScan QRIS lalu balas *Sudah Bayar*.` });
    } else {
      userStates.set(phone, { step: 'idle' });
      await menu.sendMainMenu(sock, from);
    }
    return;
  }
  if (state.step === 'order_payment') {
    if (text === 'sudah bayar') {
      await sock.sendMessage('6285727688928@s.whatsapp.net', { text: `🔔 Pembayaran Order #${state.orderId} dari ${phone}\nKetik /verifikasi ${state.orderId}` });
      await sock.sendMessage(from, { text: '✅ Pembayaran diteruskan ke admin. Menunggu verifikasi.' });
      userStates.set(phone, { step: 'idle' });
    } else if (text === 'batal') {
      userStates.set(phone, { step: 'idle' });
      await menu.sendMainMenu(sock, from);
    }
    return;
  }
  if (state.step === 'settings_name') {
    db.prepare('UPDATE users SET name=? WHERE phone=?').run(text, phone);
    userStates.set(phone, { step: 'idle' });
    await sock.sendMessage(from, { text: '✅ Nama diubah.' });
    return await menu.sendProfile(sock, from);
  }
  if (state.step === 'settings_email') {
    db.prepare('UPDATE users SET email=? WHERE phone=?').run(text, phone);
    userStates.set(phone, { step: 'idle' });
    await sock.sendMessage(from, { text: '✅ Email diubah.' });
    return await menu.sendProfile(sock, from);
  }
  if (state.step === 'settings_rekening') {
    db.prepare('UPDATE users SET no_rekening=? WHERE phone=?').run(text, phone);
    userStates.set(phone, { step: 'idle' });
    await sock.sendMessage(from, { text: '✅ No. Rekening diubah.' });
    return await menu.sendProfile(sock, from);
  }
}

// ============ INITIATE ORDER ============
async function initiateOrder(sock, from, phone, productId) {
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(productId);
  if (!product) return sock.sendMessage(from, { text: '❌ Produk tidak ditemukan.' });
  const stock = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE product_id=? AND is_sold=0').get(productId).cnt;
  if (stock < 1) return sock.sendMessage(from, { text: '❌ Stok habis.' });
  userStates.set(phone, { step: 'order_confirm', productId });
  await sock.sendMessage(from, { text: `🛒 *${product.name}*\nHarga: Rp.${product.price.toLocaleString('id-ID')}\nStok: ${stock}\n\nBalas *ya* untuk lanjut bayar, atau *batal*.` });
}

module.exports = handleMessage;
