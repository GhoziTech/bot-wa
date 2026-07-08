const db = require('./database');
const { sendQuickButtons, sendSingleSelect, truncate } = require('./message-utils');

const STORE_NAME = process.env.STORE_NAME || 'GhoziTech';
const OWNER_PHONE = process.env.OWNER_PHONE || '6285727688928';

const SALAM = `✨ *YOOO, SELAMAT DATANG DI ${STORE_NAME.toUpperCase()}!* ✨\n\n` +
  `Halo, bestie! 👋\n` +
  `Udah siap belanja produk digital dengan proses yang praktis? 🔥\n\n` +
  `Gunakan tombol yang tersedia. Pesan lain di luar tombol tidak akan dijawab bot.`;

async function sendMainMenu(sock, to) {
  return sendQuickButtons(sock, to, {
    title: `${STORE_NAME} • Menu Utama`,
    text: SALAM,
    footer: `${STORE_NAME} • #stop untuk menutup bot`,
    buttons: [
      { id: 'profile', text: '👤 Profil' },
      { id: 'list_produk', text: '📦 Produk' },
      { id: 'more_menu', text: '☰ Menu Lainnya' }
    ]
  });
}

async function sendMoreMenu(sock, to) {
  return sendSingleSelect(sock, to, {
    title: `${STORE_NAME} • Menu`,
    text: 'Pilih layanan yang ingin dibuka.',
    footer: `${STORE_NAME} • Gunakan pilihan resmi bot`,
    buttonText: 'Buka Daftar Menu',
    sections: [
      {
        title: 'Belanja',
        rows: [
          { id: 'list_produk', title: '📦 Semua Produk', description: 'Lihat seluruh katalog' },
          { id: 'kategori', title: '📂 Kategori', description: 'Cari produk per kategori' },
          { id: 'stock', title: '📊 Stok Produk', description: 'Lihat stok tersedia' },
          { id: 'isi_saldo', title: '➕ Isi Saldo', description: 'Pilih nominal top up' }
        ]
      },
      {
        title: 'Akun & Bantuan',
        rows: [
          { id: 'profile', title: '👤 Profil', description: 'Lihat data akun' },
          { id: 'order_history', title: '📜 Riwayat Order', description: 'Lihat pesanan terakhir' },
          { id: 'settings', title: '⚙️ Pengaturan', description: 'Kelola akun melalui admin' },
          { id: 'customer_service', title: '💬 Customer Service', description: 'Alihkan chat ke admin' },
          { id: 'stop_bot', title: '⏹️ Tutup Bot', description: 'Kembali ke chat biasa' }
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

  return sendQuickButtons(sock, to, {
    title: `${STORE_NAME} • Profil`,
    text,
    footer: 'Pilih tindakan berikutnya',
    buttons: [
      { id: 'isi_saldo', text: '➕ Isi Saldo' },
      { id: 'order_history', text: '📜 Riwayat' },
      { id: 'more_menu', text: '☰ Menu' }
    ]
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

  let text = `📦 *DAFTAR PRODUK (${safePage}/${totalPages})*\n\n`;
  const rows = [];

  products.forEach((product, index) => {
    const number = offset + index + 1;
    const fire = product.sold > 20 ? ' 🔥' : '';
    text += `${number}. *${product.name}*${fire}\n` +
      `   ➜ Stok: ${product.stock}\n` +
      `   ➜ Rating: ${product.rating} ⭐\n` +
      `   ➜ Terjual: ${product.sold} pcs\n` +
      `   ➜ Harga: Rp ${Number(product.price).toLocaleString('id-ID')}\n` +
      `${product.description || ''}\n\n`;

    rows.push({
      id: `order_${product.id}`,
      title: truncate(`${number}. ${product.name}`, 24),
      description: `Rp ${Number(product.price).toLocaleString('id-ID')} • Stok ${product.stock}`
    });
  });

  if (safePage < totalPages) {
    rows.push({ id: `lanjut_${safePage + 1}`, title: '➡️ Halaman Berikut', description: `Halaman ${safePage + 1}` });
  }
  if (safePage > 1) {
    rows.push({ id: `lanjut_${safePage - 1}`, title: '⬅️ Halaman Sebelum', description: `Halaman ${safePage - 1}` });
  }
  rows.push({ id: 'stock', title: '📊 Cek Stok', description: 'Lihat stok semua produk' });
  rows.push({ id: 'more_menu', title: '☰ Menu Lainnya', description: 'Kembali ke menu' });

  return sendSingleSelect(sock, to, {
    title: `${STORE_NAME} • Produk`,
    text,
    footer: 'Pilih produk dari daftar',
    buttonText: 'Pilih Produk',
    sections: [{ title: 'Produk', rows }]
  });
}

async function sendCategoryList(sock, to) {
  const categories = db.prepare(`
    SELECT DISTINCT category FROM products
    WHERE is_active=1 AND category IS NOT NULL AND TRIM(category) <> ''
    ORDER BY category
  `).all().map((row) => row.category);

  if (!categories.length) {
    return sendQuickButtons(sock, to, {
      title: `${STORE_NAME} • Kategori`,
      text: 'Belum ada kategori produk.',
      footer: STORE_NAME,
      buttons: [
        { id: 'list_produk', text: '📦 Produk' },
        { id: 'more_menu', text: '☰ Menu' }
      ]
    });
  }

  const rows = categories.slice(0, 9).map((category) => ({
    id: `kategori_${encodeURIComponent(category)}`,
    title: truncate(category, 24),
    description: 'Lihat produk kategori ini'
  }));
  rows.push({ id: 'more_menu', title: '☰ Menu Lainnya', description: 'Kembali ke menu' });

  return sendSingleSelect(sock, to, {
    title: `${STORE_NAME} • Kategori`,
    text: '📂 *PILIH KATEGORI PRODUK*',
    footer: STORE_NAME,
    buttonText: 'Pilih Kategori',
    sections: [{ title: 'Kategori', rows }]
  });
}

async function sendCategoryProducts(sock, to, category) {
  const products = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM credentials WHERE product_id=p.id AND is_sold=0) AS stock
    FROM products p WHERE category=? AND is_active=1 ORDER BY p.id LIMIT 8
  `).all(category);

  if (!products.length) {
    return sendQuickButtons(sock, to, {
      title: `${STORE_NAME} • Kategori`,
      text: 'Tidak ada produk dalam kategori ini.',
      footer: STORE_NAME,
      buttons: [
        { id: 'kategori', text: '📂 Kategori' },
        { id: 'more_menu', text: '☰ Menu' }
      ]
    });
  }

  let text = `📂 *${category}*\n\n`;
  const rows = products.map((product) => {
    text += `${product.name} — Rp ${Number(product.price).toLocaleString('id-ID')} • Stok ${product.stock}\n`;
    return {
      id: `order_${product.id}`,
      title: truncate(product.name, 24),
      description: `Rp ${Number(product.price).toLocaleString('id-ID')} • Stok ${product.stock}`
    };
  });
  rows.push({ id: 'kategori', title: '📂 Daftar Kategori', description: 'Pilih kategori lain' });
  rows.push({ id: 'more_menu', title: '☰ Menu Lainnya', description: 'Kembali ke menu' });

  return sendSingleSelect(sock, to, {
    title: truncate(`${STORE_NAME} • ${category}`, 60),
    text,
    footer: 'Pilih produk untuk order',
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
  products.forEach((product, index) => {
    text += `${index + 1}. ${product.name} ➜ Stok ${product.stock}\n`;
  });

  return sendQuickButtons(sock, to, {
    title: `${STORE_NAME} • Stok`,
    text,
    footer: 'Stok diperbarui berdasarkan database',
    buttons: [
      { id: 'list_produk', text: '📦 Produk' },
      { id: 'isi_saldo', text: '➕ Isi Saldo' },
      { id: 'more_menu', text: '☰ Menu' }
    ]
  });
}

async function sendTopupAmounts(sock, to) {
  const amounts = [10000, 20000, 50000, 100000, 200000, 500000];
  const rows = amounts.map((amount) => ({
    id: `topup_amount_${amount}`,
    title: `Rp ${amount.toLocaleString('id-ID')}`,
    description: `Top up saldo Rp ${amount.toLocaleString('id-ID')}`
  }));
  rows.push({ id: 'more_menu', title: '☰ Menu Lainnya', description: 'Batalkan top up' });

  return sendSingleSelect(sock, to, {
    title: `${STORE_NAME} • Isi Saldo`,
    text: '💰 Pilih nominal top up yang tersedia.',
    footer: 'Nominal khusus dapat diminta melalui Customer Service',
    buttonText: 'Pilih Nominal',
    sections: [{ title: 'Nominal Top Up', rows }]
  });
}

async function sendOrderHistory(sock, to, phone) {
  const orders = db.prepare(`
    SELECT o.id, p.name, o.amount, o.status, o.created_at
    FROM orders o JOIN products p ON o.product_id=p.id
    WHERE o.user_phone=? ORDER BY o.id DESC LIMIT 10
  `).all(phone);

  let text = '📜 *RIWAYAT ORDER*\n\n';
  if (!orders.length) {
    text += 'Belum ada pesanan.';
  } else {
    orders.forEach((order) => {
      const icon = order.status === 'delivered' ? '✅' : order.status === 'cancelled' ? '❌' : '⏳';
      text += `#${order.id} • ${order.name}\nRp ${Number(order.amount).toLocaleString('id-ID')} • ${icon} ${order.status}\n\n`;
    });
  }

  return sendQuickButtons(sock, to, {
    title: `${STORE_NAME} • Riwayat`,
    text,
    footer: 'Maksimal 10 order terakhir',
    buttons: [
      { id: 'list_produk', text: '📦 Produk' },
      { id: 'profile', text: '👤 Profil' },
      { id: 'more_menu', text: '☰ Menu' }
    ]
  });
}

async function sendSettings(sock, to) {
  return sendQuickButtons(sock, to, {
    title: `${STORE_NAME} • Pengaturan`,
    text: '⚙️ Perubahan nama, email, atau rekening dilakukan melalui Customer Service agar tidak ada input bebas yang diproses bot.',
    footer: 'Pilih tindakan berikutnya',
    buttons: [
      { id: 'customer_service', text: '💬 Hubungi CS' },
      { id: 'profile', text: '👤 Profil' },
      { id: 'more_menu', text: '☰ Menu' }
    ]
  });
}

async function sendOrderConfirmation(sock, to, product, stock) {
  return sendQuickButtons(sock, to, {
    title: `${STORE_NAME} • Konfirmasi`,
    text: `🛒 *KONFIRMASI ORDER*\n\nProduk: ${product.name}\nHarga: Rp ${Number(product.price).toLocaleString('id-ID')}\nStok: ${stock}\n\nLanjutkan ke pembayaran?`,
    footer: 'Periksa produk sebelum membayar',
    buttons: [
      { id: 'confirm_order', text: '✅ Lanjut Bayar' },
      { id: 'cancel_order', text: '❌ Batalkan' },
      { id: 'more_menu', text: '☰ Menu' }
    ]
  });
}

async function sendPaymentActions(sock, to, kind = 'order') {
  return sendQuickButtons(sock, to, {
    title: `${STORE_NAME} • Pembayaran`,
    text: 'Setelah pembayaran selesai, tekan tombol *Sudah Bayar*. Pembayaran tetap menunggu verifikasi admin.',
    footer: 'Jangan kirim OTP, PIN, atau password',
    buttons: [
      { id: kind === 'topup' ? 'topup_paid' : 'order_paid', text: '✅ Sudah Bayar' },
      { id: 'cancel_payment', text: '❌ Batalkan' },
      { id: 'customer_service', text: '💬 CS' }
    ]
  });
}

async function sendSubmissionReceived(sock, to, kind = 'order') {
  return sendQuickButtons(sock, to, {
    title: `${STORE_NAME} • Diproses`,
    text: kind === 'topup'
      ? '✅ Permintaan top up sudah diteruskan kepada admin untuk diverifikasi.'
      : '✅ Konfirmasi pembayaran sudah diteruskan kepada admin. Pesanan menunggu verifikasi.',
    footer: STORE_NAME,
    buttons: [
      { id: 'order_history', text: '📜 Riwayat' },
      { id: 'list_produk', text: '📦 Produk' },
      { id: 'more_menu', text: '☰ Menu' }
    ]
  });
}

async function sendErrorActions(sock, to, message) {
  return sendQuickButtons(sock, to, {
    title: `${STORE_NAME} • Informasi`,
    text: message,
    footer: STORE_NAME,
    buttons: [
      { id: 'list_produk', text: '📦 Produk' },
      { id: 'customer_service', text: '💬 CS' },
      { id: 'more_menu', text: '☰ Menu' }
    ]
  });
}

async function sendCustomerService(sock, to) {
  return sock.sendMessage(to, {
    text: `💬 *CUSTOMER SERVICE*\n\nBot telah dinonaktifkan untuk chat ini. Silakan tulis kebutuhanmu dan admin akan membalas secara manual.\n\nUntuk membuka bot kembali, kirim *#mulai*.\nAdmin: wa.me/${OWNER_PHONE}`
  });
}

module.exports = {
  sendMainMenu,
  sendMoreMenu,
  sendProfile,
  sendProductList,
  sendCategoryList,
  sendCategoryProducts,
  sendStockList,
  sendTopupAmounts,
  sendOrderHistory,
  sendSettings,
  sendOrderConfirmation,
  sendPaymentActions,
  sendSubmissionReceived,
  sendErrorActions,
  sendCustomerService
};
