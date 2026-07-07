const db = require('./database');

async function sendMainMenu(sock, to) {
  const sections = [{
    title: '📌 Menu Utama',
    rows: [
      { title: '👤 Profile', rowId: 'profile', description: 'Lihat profil & saldo' },
      { title: '📦 List Produk', rowId: 'list_produk', description: 'Semua produk' },
      { title: '📂 Kategori', rowId: 'kategori', description: 'Lihat per kategori' },
      { title: '📊 Stock Product', rowId: 'stock', description: 'Stok terkini' }
    ]
  }];
  await sock.sendMessage(to, {
    text: '✨ Selamat datang di StoreBot!\nKetik #mulai untuk kembali.',
    footer: 'Pilih menu:',
    title: 'Menu Utama',
    buttonText: 'Pilih',
    sections
  });
}

async function sendProfile(sock, to) {
  const phone = to.split('@')[0];
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) return;
  let text = `🧑 Profil Akun\n\n📛 Nama: ${user.name || '-'}\n📞 Phone: ${user.phone}\n📩 Email: ${user.email || '-'}\n💰 Saldo: Rp ${user.saldo.toLocaleString('id-ID')}\n🔢 Total Order: ${user.total_order}\n🚮 Total Pengeluaran: Rp ${user.total_pengeluaran.toLocaleString('id-ID')}\n💳 No. Rekening: ${user.no_rekening || '-'}`;
  const rows = [
    { title: '➕ Isi Saldo', rowId: 'isi_saldo', description: '' },
    { title: '📜 Order History', rowId: 'order_history', description: '' },
    { title: '📞 Customer Service', rowId: 'customer_service', description: '' },
    { title: '⚙️ Settings', rowId: 'settings', description: '' },
    { title: '🔙 Kembali Menu', rowId: 'kembali_menu', description: '' }
  ];
  await sock.sendMessage(to, {
    text,
    footer: 'Pilih aksi:',
    title: 'Profile',
    buttonText: 'Pilih',
    sections: [{ rows }]
  });
}

async function sendProductList(sock, to, page = 1) {
  const perPage = 5, offset = (page - 1) * perPage;
  const products = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM credentials WHERE product_id=p.id AND is_sold=0) AS stock
    FROM products p WHERE p.is_active=1 ORDER BY p.id LIMIT ? OFFSET ?
  `).all(perPage, offset);
  const total = db.prepare('SELECT COUNT(*) AS cnt FROM products WHERE is_active=1').get().cnt;
  const totalPages = Math.ceil(total / perPage);
  let desc = `📦 Daftar Semua Produk (${page}/${totalPages})\n\n`;
  const rows = [];
  products.forEach((p, i) => {
    const num = offset + i + 1, fire = p.sold > 20 ? ' 🔥' : '';
    desc += `${num}. *${p.name}*${fire}\n   ➜ Stock: ${p.stock}\n   ➜ Rating: ${p.rating} ⭐\n   ➜ Terjual: ${p.sold} pcs\n   ➜ Harga: Rp.${p.price.toLocaleString('id-ID')}\n${p.description}\n\n`;
    rows.push({ title: `${num}. ${p.name} ${fire}`, rowId: `order_${p.id}`, description: `Rp.${p.price.toLocaleString('id-ID')} | Stok: ${p.stock}` });
  });
  if (page < totalPages) rows.push({ title: '➡️ Lanjut halaman berikutnya', rowId: `lanjut_${page + 1}`, description: '' });
  if (page > 1) rows.push({ title: '⬅️ Kembali halaman sebelumnya', rowId: `lanjut_${page - 1}`, description: '' });
  rows.push({ title: '🔙 Kembali ke Menu Utama', rowId: 'kembali_menu', description: '' });
  await sock.sendMessage(to, {
    text: desc,
    footer: 'Pilih produk untuk memesan',
    title: 'List Produk',
    buttonText: 'Pilih Produk',
    sections: [{ title: 'Pilih Produk', rows }]
  });
}

async function sendStockList(sock, to) {
  const products = db.prepare(`SELECT p.name, (SELECT COUNT(*) FROM credentials WHERE product_id=p.id AND is_sold=0) AS stock FROM products p WHERE is_active=1`).all();
  let text = '📦 Daftar Stock Product\n\n';
  products.forEach(p => text += `${p.name} ➜ Stock ${p.stock}\n`);
  await sock.sendMessage(to, { text });
}

async function sendCategoryList(sock, to) {
  const cats = db.prepare('SELECT DISTINCT category FROM products WHERE is_active=1').all().map(c => c.category);
  if (!cats.length) return sock.sendMessage(to, { text: 'Belum ada kategori.' });
  const rows = cats.map(c => ({ title: c, rowId: `kategori_${c}`, description: '' }));
  rows.push({ title: '🔙 Kembali Menu', rowId: 'kembali_menu', description: '' });
  await sock.sendMessage(to, {
    text: '📂 Kategori Produk',
    footer: 'Pilih kategori',
    title: 'Kategori',
    buttonText: 'Pilih',
    sections: [{ rows }]
  });
}

async function sendCategoryProducts(sock, to, category) {
  const products = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM credentials WHERE product_id=p.id AND is_sold=0) AS stock FROM products p WHERE category=? AND is_active=1`).all(category);
  if (!products.length) return sock.sendMessage(to, { text: 'Tidak ada produk.' });
  let text = `📂 ${category}\n\n`;
  const rows = products.map(p => {
    text += `${p.name} - Rp.${p.price.toLocaleString('id-ID')} (Stok: ${p.stock})\n`;
    return { title: p.name, rowId: `order_${p.id}`, description: `Rp.${p.price.toLocaleString('id-ID')}` };
  });
  rows.push({ title: '🔙 Kembali ke Kategori', rowId: 'kategori', description: '' });
  await sock.sendMessage(to, {
    text,
    footer: 'Pilih produk',
    title: 'Produk',
    buttonText: 'Pilih',
    sections: [{ rows }]
  });
}

async function sendOrderHistory(sock, to) {
  const phone = to.split('@')[0];
  const orders = db.prepare(`SELECT o.id, p.name, o.amount, o.status, o.created_at FROM orders o JOIN products p ON o.product_id=p.id WHERE o.user_phone=? ORDER BY o.id DESC LIMIT 10`).all(phone);
  if (!orders.length) return sock.sendMessage(to, { text: 'Belum ada order.' });
  let text = '📜 Riwayat Order Terakhir\n\n';
  orders.forEach(o => text += `#${o.id} - ${o.name} Rp.${o.amount.toLocaleString('id-ID')} (${o.status==='delivered'?'✅':o.status==='paid'?'💰':'⏳'})\n`);
  await sock.sendMessage(to, { text });
}

async function sendCustomerService(sock, to) {
  await sock.sendMessage(to, { text: '📞 Customer Service\nHubungi admin: wa.me/6285727688928' });
}

async function sendSettings(sock, to) {
  const rows = [
    { title: '✏️ Ubah Nama', rowId: 'set_nama', description: '' },
    { title: '📧 Ubah Email', rowId: 'set_email', description: '' },
    { title: '💳 Ubah Rekening', rowId: 'set_rekening', description: '' },
    { title: '🔙 Kembali Menu', rowId: 'kembali_menu', description: '' }
  ];
  await sock.sendMessage(to, {
    text: '⚙️ Pengaturan Akun',
    footer: 'Pilih pengaturan',
    title: 'Settings',
    buttonText: 'Pilih',
    sections: [{ rows }]
  });
}

module.exports = { sendMainMenu, sendProfile, sendProductList, sendStockList, sendCategoryList, sendCategoryProducts, sendOrderHistory, sendCustomerService, sendSettings };
