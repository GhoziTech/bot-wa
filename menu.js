const db = require('./database');

const STORE_NAME = process.env.STORE_NAME || 'GhoziTech';

function money(value) {
  return Number(value || 0).toLocaleString('id-ID');
}

function statusLabel(status) {
  const labels = {
    delivered: '✅ Selesai',
    paid: '💰 Dibayar',
    pending: '⏳ Menunggu',
    cancelled: '❌ Dibatalkan'
  };
  return labels[status] || status;
}

async function sendText(sock, to, text) {
  const result = await sock.sendMessage(to, { text });
  console.log(`[OUT] text to=${to} id=${result?.key?.id || '-'}`);
  return result;
}

async function sendMainMenu(sock, to, name = '') {
  const greetingName = name ? `, *${name}*` : '';
  return sendText(sock, to,
`✨ *YOOO, SELAMAT DATANG DI ${STORE_NAME.toUpperCase()}!* ✨

Halo${greetingName}! 👋
Udah siap belanja produk digital dengan proses yang praktis, cepat, dan anti ribet? 🔥

Silakan balas menggunakan *nomor pilihan* di bawah. Pesan selain pilihan yang tersedia tidak akan dijawab bot.

*MENU UTAMA*
1. 👤 Profile
2. 📦 Semua Produk
3. 📂 Kategori Produk
4. 📊 Stock Product
5. ➕ Isi Saldo
6. 📜 Order History
7. 🔥 Top Order
8. ⚙️ Settings Account
9. 💬 Customer Service
0. ⏹️ Tutup Bot

_Ketik hanya angkanya, contoh: 1_`);
}

async function sendProfile(sock, to, userKey) {
  const user = db.prepare('SELECT * FROM users WHERE phone=?').get(userKey);
  if (!user) return;

  return sendText(sock, to,
`👤 *PROFILE ACCOUNT*

Nama: ${user.name || '-'}
📞 Phone/ID: ${user.phone}
📩 Email: ${user.email || '-'}
💰 Saldo: Rp ${money(user.saldo)}
🔢 Total Order: ${user.total_order || 0}
🧾 Total Pengeluaran: Rp ${money(user.total_pengeluaran)}
💳 Nomor Rekening: ${user.no_rekening || '-'}

*PILIHAN PROFILE*
1. ➕ Isi Saldo
2. 📜 Order History
3. ⚙️ Settings Account
4. 📦 Semua Produk
9. 💬 Customer Service
0. 🏠 Menu Utama`);
}

function getProductsPage(page = 1, category = null) {
  const perPage = 5;
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * perPage;
  const filter = category ? 'AND p.category=?' : '';
  const params = category ? [category, perPage, offset] : [perPage, offset];
  const countParams = category ? [category] : [];

  const products = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM credentials c WHERE c.product_id=p.id AND c.is_sold=0) AS stock
    FROM products p
    WHERE p.is_active=1 ${filter}
    ORDER BY p.id
    LIMIT ? OFFSET ?
  `).all(...params);

  const total = db.prepare(`
    SELECT COUNT(*) AS cnt FROM products p
    WHERE p.is_active=1 ${category ? 'AND p.category=?' : ''}
  `).get(...countParams).cnt;

  return {
    products,
    page: safePage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    offset
  };
}

async function sendProductList(sock, to, page = 1, category = null) {
  const data = getProductsPage(page, category);
  if (!data.products.length && data.page > 1) {
    return sendProductList(sock, to, data.totalPages, category);
  }

  const title = category ? `KATEGORI: ${category}` : 'SEMUA PRODUK';
  let text = `📦 *${title} (${data.page}/${data.totalPages})*\n\n`;

  if (!data.products.length) {
    text += 'Belum ada produk aktif pada daftar ini.\n\n';
  }

  data.products.forEach((product, index) => {
    const number = index + 1;
    const fire = Number(product.sold) >= 20 ? ' 🔥' : '';
    text += `${number}. *${product.name}*${fire}\n`;
    text += `   ➜ Stock: ${product.stock}\n`;
    text += `   ➜ Rating: ${Number(product.rating || 0).toFixed(1)} ⭐\n`;
    text += `   ➜ Terjual: ${product.sold || 0} pcs\n`;
    text += `   ➜ Harga: Rp ${money(product.price)}\n`;
    if (product.description) text += `${product.description}\n`;
    text += '\n';
  });

  text += '*PILIHAN*\n';
  if (data.products.length) text += '1–5. Pilih produk sesuai nomor di atas\n';
  if (data.page < data.totalPages) text += '6. ➡️ Halaman Berikutnya\n';
  if (data.page > 1) text += '7. ⬅️ Halaman Sebelumnya\n';
  text += category ? '8. 📂 Kembali ke Kategori\n' : '8. 📊 Lihat Stock\n';
  text += category ? '9. 📦 Semua Produk\n' : '9. 📂 Kategori Produk\n';
  text += '0. 🏠 Menu Utama';

  await sendText(sock, to, text);
  return data;
}

async function sendProductDetail(sock, to, productId) {
  const product = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM credentials c WHERE c.product_id=p.id AND c.is_sold=0) AS stock
    FROM products p WHERE p.id=? AND p.is_active=1
  `).get(productId);

  if (!product) return null;

  await sendText(sock, to,
`🛍️ *DETAIL PRODUK*

📦 Produk: *${product.name}*
📂 Kategori: ${product.category || '-'}
💰 Harga: Rp ${money(product.price)}
📊 Stock: ${product.stock}
⭐ Rating: ${Number(product.rating || 0).toFixed(1)}
🛒 Terjual: ${product.sold || 0} pcs

${product.description || 'Tidak ada deskripsi tambahan.'}

*PILIHAN*
1. 🛒 Beli Sekarang
2. 📦 Kembali ke Daftar Produk
9. 💬 Customer Service
0. 🏠 Menu Utama`);

  return product;
}

async function sendOrderConfirmation(sock, to, product, stock) {
  return sendText(sock, to,
`🧾 *KONFIRMASI ORDER*

Produk: *${product.name}*
Harga: Rp ${money(product.price)}
Stock tersedia: ${stock}

Pastikan produk dan ketentuannya sudah sesuai sebelum melanjutkan.

*PILIHAN*
1. ✅ Lanjut ke Pembayaran
2. ❌ Batalkan
0. 🏠 Menu Utama`);
}

async function sendPaymentMenu(sock, to, type, data) {
  const isOrder = type === 'order';
  return sendText(sock, to,
`💳 *${isOrder ? 'PEMBAYARAN ORDER' : 'TOP UP SALDO'}*

${isOrder ? `Order: #${data.orderId}\nProduk: ${data.productName}\n` : ''}Total: *Rp ${money(data.amount)}*

Scan QRIS yang dikirim di atas. Setelah pembayaran selesai, pilih jawaban berikut.

*PILIHAN*
1. ✅ Sudah Bayar
2. ❌ Batalkan
9. 💬 Customer Service
0. 🏠 Menu Utama`);
}

async function sendTopupMenu(sock, to) {
  return sendText(sock, to,
`➕ *ISI SALDO*

Pilih nominal top up:

1. Rp 10.000
2. Rp 20.000
3. Rp 50.000
4. Rp 100.000
5. Rp 200.000
6. Rp 500.000
0. 🏠 Menu Utama

_Balas menggunakan nomor pilihan._`);
}

async function sendCategoryList(sock, to, page = 1) {
  const perPage = 7;
  const total = db.prepare(`
    SELECT COUNT(DISTINCT category) AS cnt
    FROM products
    WHERE is_active=1 AND category IS NOT NULL AND TRIM(category)<>''
  `).get().cnt;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(totalPages, Math.max(1, Number(page) || 1));
  const offset = (safePage - 1) * perPage;
  const categories = db.prepare(`
    SELECT category, COUNT(*) AS total
    FROM products
    WHERE is_active=1 AND category IS NOT NULL AND TRIM(category)<>''
    GROUP BY category
    ORDER BY category
    LIMIT ? OFFSET ?
  `).all(perPage, offset);

  let text = `📂 *KATEGORI PRODUK (${safePage}/${totalPages})*\n\n`;
  if (!categories.length) text += 'Belum ada kategori produk aktif.\n';
  categories.forEach((category, index) => {
    text += `${index + 1}. ${category.category} (${category.total} produk)\n`;
  });

  text += '\n*PILIHAN*\n';
  if (categories.length) text += '1–7. Pilih kategori sesuai nomor\n';
  if (safePage < totalPages) text += '8. ➡️ Halaman Berikutnya\n';
  if (safePage > 1) text += '9. ⬅️ Halaman Sebelumnya\n';
  text += '0. 🏠 Menu Utama';

  await sendText(sock, to, text);
  return { categories, page: safePage, totalPages };
}

async function sendStockList(sock, to, page = 1) {
  const perPage = 10;
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * perPage;
  const products = db.prepare(`
    SELECT p.name,
      (SELECT COUNT(*) FROM credentials c WHERE c.product_id=p.id AND c.is_sold=0) AS stock
    FROM products p
    WHERE p.is_active=1
    ORDER BY p.id
    LIMIT ? OFFSET ?
  `).all(perPage, offset);
  const total = db.prepare('SELECT COUNT(*) AS cnt FROM products WHERE is_active=1').get().cnt;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  let text = `📊 *DAFTAR STOCK PRODUCT (${safePage}/${totalPages})*\n\n`;
  if (!products.length) text += 'Belum ada produk aktif.\n';
  products.forEach((product, index) => {
    text += `${offset + index + 1}. ${product.name} ➜ Stock ${product.stock}\n`;
  });

  text += '\n*PILIHAN*\n';
  if (safePage < totalPages) text += '1. ➡️ Halaman Berikutnya\n';
  if (safePage > 1) text += '2. ⬅️ Halaman Sebelumnya\n';
  text += '3. 📦 Semua Produk\n';
  text += '4. 📂 Kategori Produk\n';
  text += '0. 🏠 Menu Utama';

  await sendText(sock, to, text);
  return { page: safePage, totalPages };
}

async function sendOrderHistory(sock, to, userKey) {
  const orders = db.prepare(`
    SELECT o.id, p.name, o.amount, o.status, o.created_at
    FROM orders o
    JOIN products p ON p.id=o.product_id
    WHERE o.user_phone=?
    ORDER BY o.id DESC
    LIMIT 10
  `).all(userKey);

  let text = '📜 *ORDER HISTORY*\n\n';
  if (!orders.length) {
    text += 'Belum ada riwayat order pada akun ini.\n';
  } else {
    orders.forEach((order) => {
      text += `#${order.id} • ${order.name}\n`;
      text += `Rp ${money(order.amount)} • ${statusLabel(order.status)}\n`;
      text += `${order.created_at}\n\n`;
    });
  }

  text += '*PILIHAN*\n';
  text += '1. 📦 Semua Produk\n';
  text += '2. ➕ Isi Saldo\n';
  text += '9. 💬 Customer Service\n';
  text += '0. 🏠 Menu Utama';

  return sendText(sock, to, text);
}

async function sendTopOrder(sock, to) {
  const products = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM credentials c WHERE c.product_id=p.id AND c.is_sold=0) AS stock
    FROM products p
    WHERE p.is_active=1
    ORDER BY p.sold DESC, p.rating DESC
    LIMIT 5
  `).all();

  let text = '🔥 *TOP ORDER GHOTZITECH*\n\n';
  if (!products.length) text += 'Belum ada produk aktif.\n';
  products.forEach((product, index) => {
    text += `${index + 1}. *${product.name}*\n`;
    text += `   Terjual ${product.sold || 0} • Stock ${product.stock} • Rp ${money(product.price)}\n\n`;
  });
  text += '*PILIHAN*\n';
  if (products.length) text += '1–5. Pilih produk sesuai nomor\n';
  text += '8. 📦 Semua Produk\n';
  text += '9. 📂 Kategori Produk\n';
  text += '0. 🏠 Menu Utama';
  await sendText(sock, to, text);
  return { products };
}

async function sendSettings(sock, to) {
  return sendText(sock, to,
`⚙️ *SETTINGS ACCOUNT*

Untuk menjaga keamanan, perubahan nama, email, dan rekening dilakukan melalui Customer Service agar dapat diverifikasi oleh admin.

*PILIHAN*
1. 👤 Lihat Profile
2. ✏️ Ubah Data melalui CS
3. 🔐 Informasi Keamanan
0. 🏠 Menu Utama`);
}

async function sendSecurityInfo(sock, to) {
  return sendText(sock, to,
`🔐 *INFORMASI KEAMANAN*

• Admin tidak pernah meminta OTP, PIN, atau kode verifikasi WhatsApp.
• Jangan membagikan password pribadi di luar kebutuhan produk yang sah.
• Simpan nomor order untuk proses bantuan dan garansi.
• Pastikan pembayaran hanya melalui instruksi resmi bot/admin.

*PILIHAN*
1. ⚙️ Kembali ke Settings
9. 💬 Customer Service
0. 🏠 Menu Utama`);
}

async function sendSubmissionReceived(sock, to, type) {
  return sendText(sock, to,
`✅ *${type === 'order' ? 'KONFIRMASI PEMBAYARAN DITERIMA' : 'PERMINTAAN TOP UP DITERIMA'}*

Data sudah diteruskan kepada admin untuk diperiksa. Mohon tunggu proses verifikasi.

*PILIHAN*
1. 🏠 Menu Utama
2. 📜 Order History
9. 💬 Customer Service
0. ⏹️ Tutup Bot`);
}

async function sendCustomerService(sock, to) {
  return sendText(sock, to,
`💬 *CUSTOMER SERVICE ${STORE_NAME.toUpperCase()}*

Bot sudah dinonaktifkan untuk percakapan ini. Silakan tulis kebutuhan Anda secara normal; admin akan membalas langsung melalui WhatsApp Business.

Untuk membuka bot kembali, kirim *#mulai* atau */mulai*.`);
}

async function sendStopped(sock, to) {
  return sendText(sock, to,
`⏹️ *BOT DINONAKTIFKAN*

Pesan biasa tidak akan dijawab bot. Admin tetap dapat membalas percakapan secara manual.

Kirim *#mulai* atau */mulai* untuk membuka menu kembali.`);
}

module.exports = {
  sendText,
  sendMainMenu,
  sendProfile,
  sendProductList,
  sendProductDetail,
  sendOrderConfirmation,
  sendPaymentMenu,
  sendTopupMenu,
  sendCategoryList,
  sendStockList,
  sendOrderHistory,
  sendTopOrder,
  sendSettings,
  sendSecurityInfo,
  sendSubmissionReceived,
  sendCustomerService,
  sendStopped
};
