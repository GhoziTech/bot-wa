const db = require('./database');
const { sendList, sendButtons, truncate } = require('./message-utils');

const STORE_NAME = process.env.STORE_NAME || 'GhoziTech';
const OWNER_PHONE = process.env.OWNER_PHONE || '6285727688928';

const SALAM = `✨ *SELAMAT DATANG DI ${STORE_NAME.toUpperCase()}* ✨\n\n` +
  `Halo! 👋 Pilih layanan melalui menu interaktif di bawah.\n\n` +
  `Bot hanya aktif setelah kamu mengirim *#mulai*. Untuk kembali ke percakapan biasa dengan admin, pilih *Customer Service* atau kirim *#stop*.`;

async function sendMainMenu(sock, to) {
  return sendList(sock, to, {
    title: `${STORE_NAME} Menu`,
    text: SALAM,
    footer: `${STORE_NAME} • Ketik #stop untuk menutup bot`,
    buttonText: 'Buka Menu',
    sections: [
      {
        title: 'Akun',
        rows: [
          { title: '👤 Profil', rowId: 'profile', description: 'Saldo dan data akun' },
          { title: '📜 Riwayat Order', rowId: 'order_history', description: 'Lihat pesanan terakhir' },
          { title: '⚙️ Pengaturan', rowId: 'settings', description: 'Ubah nama, email, rekening' }
        ]
      },
      {
        title: 'Belanja',
        rows: [
          { title: '📦 Semua Produk', rowId: 'list_produk', description: 'Lihat katalog produk' },
          { title: '📂 Kategori', rowId: 'kategori', description: 'Cari berdasarkan kategori' },
          { title: '📊 Cek Stok', rowId: 'stock', description: 'Stok tersedia saat ini' }
        ]
      },
      {
        title: 'Bantuan',
        rows: [
          { title: '➕ Isi Saldo', rowId: 'isi_saldo', description: 'Ajukan top up saldo' },
          { title: '💬 Customer Service', rowId: 'customer_service', description: 'Alihkan ke admin manusia' },
          { title: '⏹️ Tutup Bot', rowId: 'stop_bot', description: 'Bot berhenti membalas chat' }
        ]
      }
    ]
  });
}

async function sendProfile(sock, to, phone) {
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) return;

  const text = `👤 *PROFIL AKUN*\n\n` +
    `Nama: ${user.name || '-'}\n` +
    `📞 Phone/ID: ${user.phone}\n` +
    `📩 Email: ${user.email || '-'}\n` +
    `💰 Saldo: Rp ${Number(user.saldo || 0).toLocaleString('id-ID')}\n` +
    `🔢 Total Order: ${user.total_order || 0}\n` +
    `🧾 Total Pengeluaran: Rp ${Number(user.total_pengeluaran || 0).toLocaleString('id-ID')}\n` +
    `💳 No. Rekening: ${user.no_rekening || '-'}`;

  return sendList(sock, to, {
    title: 'Profil Akun',
    text,
    footer: `${STORE_NAME} • Kelola akun`,
    buttonText: 'Pilih Aksi',
    sections: [{
      title: 'Aksi Profil',
      rows: [
        { title: '➕ Isi Saldo', rowId: 'isi_saldo', description: 'Top up saldo akun' },
        { title: '📜 Riwayat Order', rowId: 'order_history', description: 'Pesanan terakhir' },
        { title: '💬 Customer Service', rowId: 'customer_service', description: 'Bicara dengan admin' },
        { title: '⚙️ Pengaturan', rowId: 'settings', description: 'Ubah informasi akun' },
        { title: '🔙 Menu Utama', rowId: 'kembali_menu', description: 'Kembali ke menu' }
      ]
    }]
  });
}

async function sendProductList(sock, to, page = 1) {
  const perPage = 5;
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const offset = (safePage - 1) * perPage;
  const products = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM credentials WHERE product_id=p.id AND is_sold=0) AS stock
    FROM products p WHERE p.is_active=1 ORDER BY p.id LIMIT ? OFFSET ?
  `).all(perPage, offset);
  const total = db.prepare('SELECT COUNT(*) AS cnt FROM products WHERE is_active=1').get().cnt;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (!products.length && safePage > 1) return sendProductList(sock, to, totalPages);

  let desc = `📦 *DAFTAR PRODUK (${safePage}/${totalPages})*\n\n`;
  const rows = [];

  products.forEach((p, i) => {
    const num = offset + i + 1;
    const fire = p.sold > 20 ? ' 🔥' : '';
    desc += `${num}. *${p.name}*${fire}\n` +
      `   ➜ Stok: ${p.stock}\n` +
      `   ➜ Rating: ${p.rating} ⭐\n` +
      `   ➜ Terjual: ${p.sold} pcs\n` +
      `   ➜ Harga: Rp ${Number(p.price).toLocaleString('id-ID')}\n` +
      `${p.description || ''}\n\n`;

    rows.push({
      title: truncate(`${num}. ${p.name}`, 24),
      rowId: `order_${p.id}`,
      description: `Rp ${Number(p.price).toLocaleString('id-ID')} • Stok ${p.stock}`
    });
  });

  if (safePage < totalPages) rows.push({ title: '➡️ Halaman Berikut', rowId: `lanjut_${safePage + 1}`, description: `Buka halaman ${safePage + 1}` });
  if (safePage > 1) rows.push({ title: '⬅️ Halaman Sebelum', rowId: `lanjut_${safePage - 1}`, description: `Kembali ke halaman ${safePage - 1}` });
  rows.push({ title: '📊 Cek Stok', rowId: 'stock', description: 'Lihat stok semua produk' });
  rows.push({ title: '🔙 Menu Utama', rowId: 'kembali_menu', description: 'Kembali ke menu' });

  return sendList(sock, to, {
    title: 'Daftar Produk',
    text: desc,
    footer: `${STORE_NAME} • Pilih produk untuk order`,
    buttonText: 'Pilih Produk',
    sections: [{ title: 'Produk', rows }]
  });
}

async function sendStockList(sock, to) {
  const products = db.prepare(`
    SELECT p.name,
      (SELECT COUNT(*) FROM credentials WHERE product_id=p.id AND is_sold=0) AS stock
    FROM products p WHERE p.is_active=1 ORDER BY stock DESC, p.name ASC
  `).all();

  let text = '📦 *DAFTAR STOK PRODUK*\n\n';
  products.forEach((p, index) => {
    text += `${index + 1}. ${p.name} ➜ Stok ${p.stock}\n`;
  });

  return sendButtons(sock, to, {
    text,
    footer: `${STORE_NAME} • Stok real-time`,
    buttons: [
      { id: 'list_produk', text: '📦 Lihat Produk' },
      { id: 'kembali_menu', text: '🏠 Menu Utama' },
      { id: 'customer_service', text: '💬 CS' }
    ]
  });
}

async function sendCategoryList(sock, to) {
  const cats = db.prepare('SELECT DISTINCT category FROM products WHERE is_active=1 AND category IS NOT NULL ORDER BY category').all().map((c) => c.category);
  if (!cats.length) return sock.sendMessage(to, { text: 'Belum ada kategori.' });

  const rows = cats.slice(0, 9).map((category) => ({
    title: truncate(category, 24),
    rowId: `kategori_${encodeURIComponent(category)}`,
    description: 'Lihat produk kategori ini'
  }));
  rows.push({ title: '🔙 Menu Utama', rowId: 'kembali_menu', description: 'Kembali ke menu' });

  return sendList(sock, to, {
    title: 'Kategori Produk',
    text: '📂 *PILIH KATEGORI PRODUK*',
    footer: `${STORE_NAME} • Maksimal 9 kategori per menu`,
    buttonText: 'Pilih Kategori',
    sections: [{ title: 'Kategori', rows }]
  });
}

async function sendCategoryProducts(sock, to, category) {
  const products = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM credentials WHERE product_id=p.id AND is_sold=0) AS stock
    FROM products p WHERE category=? AND is_active=1 ORDER BY p.id LIMIT 8
  `).all(category);
  if (!products.length) return sock.sendMessage(to, { text: 'Tidak ada produk pada kategori ini.' });

  let text = `📂 *${category}*\n\n`;
  const rows = products.map((p) => {
    text += `${p.name} — Rp ${Number(p.price).toLocaleString('id-ID')} (Stok ${p.stock})\n`;
    return {
      title: truncate(p.name, 24),
      rowId: `order_${p.id}`,
      description: `Rp ${Number(p.price).toLocaleString('id-ID')} • Stok ${p.stock}`
    };
  });
  rows.push({ title: '🔙 Daftar Kategori', rowId: 'kategori', description: 'Kembali ke kategori' });
  rows.push({ title: '🏠 Menu Utama', rowId: 'kembali_menu', description: 'Kembali ke menu' });

  return sendList(sock, to, {
    title: truncate(`Kategori ${category}`, 60),
    text,
    footer: `${STORE_NAME} • Pilih produk`,
    buttonText: 'Pilih Produk',
    sections: [{ title: 'Produk', rows }]
  });
}

async function sendOrderHistory(sock, to, phone) {
  const orders = db.prepare(`
    SELECT o.id, p.name, o.amount, o.status, o.created_at
    FROM orders o JOIN products p ON o.product_id=p.id
    WHERE o.user_phone=? ORDER BY o.id DESC LIMIT 10
  `).all(phone);

  if (!orders.length) {
    return sendButtons(sock, to, {
      text: '📜 Kamu belum memiliki riwayat order.',
      footer: STORE_NAME,
      buttons: [
        { id: 'list_produk', text: '📦 Lihat Produk' },
        { id: 'kembali_menu', text: '🏠 Menu Utama' }
      ]
    });
  }

  let text = '📜 *RIWAYAT ORDER*\n\n';
  orders.forEach((o) => {
    const icon = o.status === 'delivered' ? '✅' : o.status === 'paid' ? '💰' : '⏳';
    text += `#${o.id} • ${o.name}\nRp ${Number(o.amount).toLocaleString('id-ID')} • ${icon} ${o.status}\n\n`;
  });

  return sendButtons(sock, to, {
    text,
    footer: `${STORE_NAME} • 10 order terakhir`,
    buttons: [
      { id: 'list_produk', text: '📦 Produk' },
      { id: 'kembali_menu', text: '🏠 Menu' },
      { id: 'customer_service', text: '💬 CS' }
    ]
  });
}

async function sendCustomerService(sock, to) {
  return sock.sendMessage(to, {
    text: `💬 *CUSTOMER SERVICE*\n\nBot telah dinonaktifkan untuk chat ini. Silakan tulis kebutuhanmu; admin akan membalas secara manual.\n\nUntuk membuka bot kembali, kirim *#mulai*.\nAdmin: wa.me/${OWNER_PHONE}`
  });
}

async function sendSettings(sock, to) {
  return sendList(sock, to, {
    title: 'Pengaturan Akun',
    text: '⚙️ *PENGATURAN AKUN*',
    footer: `${STORE_NAME} • Pilih data yang ingin diubah`,
    buttonText: 'Pilih Pengaturan',
    sections: [{
      title: 'Pengaturan',
      rows: [
        { title: '✏️ Ubah Nama', rowId: 'set_nama', description: 'Perbarui nama profil' },
        { title: '📧 Ubah Email', rowId: 'set_email', description: 'Perbarui email akun' },
        { title: '💳 Ubah Rekening', rowId: 'set_rekening', description: 'Perbarui rekening refund' },
        { title: '🔙 Menu Utama', rowId: 'kembali_menu', description: 'Kembali ke menu' }
      ]
    }]
  });
}

async function sendOrderConfirmation(sock, to, product, stock) {
  return sendButtons(sock, to, {
    text: `🛒 *KONFIRMASI ORDER*\n\nProduk: ${product.name}\nHarga: Rp ${Number(product.price).toLocaleString('id-ID')}\nStok: ${stock}\n\nLanjutkan ke pembayaran?`,
    footer: `${STORE_NAME} • Periksa pesanan`,
    buttons: [
      { id: 'confirm_order', text: '✅ Lanjut Bayar' },
      { id: 'cancel_order', text: '❌ Batal' },
      { id: 'kembali_menu', text: '🏠 Menu' }
    ]
  });
}

async function sendPaymentActions(sock, to, kind = 'order') {
  return sendButtons(sock, to, {
    text: 'Setelah pembayaran selesai, tekan tombol di bawah. Status tetap menunggu verifikasi admin.',
    footer: `${STORE_NAME} • Jangan kirim OTP/PIN`,
    buttons: [
      { id: kind === 'topup' ? 'topup_paid' : 'order_paid', text: '✅ Sudah Bayar' },
      { id: 'cancel_payment', text: '❌ Batalkan' },
      { id: 'customer_service', text: '💬 CS' }
    ]
  });
}

module.exports = {
  sendMainMenu,
  sendProfile,
  sendProductList,
  sendStockList,
  sendCategoryList,
  sendCategoryProducts,
  sendOrderHistory,
  sendCustomerService,
  sendSettings,
  sendOrderConfirmation,
  sendPaymentActions
};
