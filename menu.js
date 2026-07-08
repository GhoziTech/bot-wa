const db = require('./database');

// Salam Gen Z ala GhoziTech
const SALAM = `✨ *YOOO, SELAMAT DATANG DI GHOTZITECH!* ✨\n\n` +
              `Halo, bestie! 👋\n` +
              `Udah siap belanja produk digital paling cuan se-Indonesia? 🔥\n` +
              `Di sini lo bisa dapetin akun premium murah parah, aman, dan anti ribet. Nggak percaya? Coba aja sendiri!\n\n` +
              `*PILIH MENU DI BAWAH YAA* 👇`;

async function sendMainMenu(sock, to) {
  const sections = [{
    rows: [
      { title: '👤 Profile', id: 'profile', description: 'Cek saldo & data lo' },
      { title: '📦 List Produk', id: 'list_produk', description: 'Semua produk kami' },
      { title: '📂 Kategori', id: 'kategori', description: 'Cari berdasarkan kategori' },
      { title: '📊 Stock Product', id: 'stock', description: 'Stok ter-update' }
    ]
  }];
  await sock.sendMessage(to, {
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'GhoziTech - Selamat Datang' },
      body: { text: SALAM },
      footer: { text: 'GhoziTech - Langganan digital murah abis! 🤑' },
      action: { button: 'Pilih Menu', sections }
    }
  });
}

async function sendProfile(sock, to) {
  const phone = to.split('@')[0];
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) return;
  let text = `🧑 *Profil Akun Lo*\n\n` +
             `📛 Nama: ${user.name || '-'}\n` +
             `📞 Phone: ${user.phone}\n` +
             `📩 Email: ${user.email || '-'}\n` +
             `💰 Saldo: Rp ${user.saldo.toLocaleString('id-ID')}\n` +
             `🔢 Total Order: ${user.total_order}\n` +
             `🚮 Total Pengeluaran: Rp ${user.total_pengeluaran.toLocaleString('id-ID')}\n` +
             `💳 No. Rekening: ${user.no_rekening || '-'}`;
  const rows = [
    { title: '➕ Isi Saldo', id: 'isi_saldo', description: '' },
    { title: '📜 Order History', id: 'order_history', description: '' },
    { title: '📞 Customer Service', id: 'customer_service', description: '' },
    { title: '⚙️ Settings', id: 'settings', description: '' },
    { title: '🔙 Kembali Menu', id: 'kembali_menu', description: '' }
  ];
  await sock.sendMessage(to, {
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Profil Kamu' },
      body: { text },
      footer: { text: 'GhoziTech - Manage akun lo.' },
      action: { button: 'Pilih', sections: [{ rows }] }
    }
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
  let desc = `📦 *Daftar Produk (${page}/${totalPages})*\n\n`;
  const rows = [];
  products.forEach((p, i) => {
    const num = offset + i + 1, fire = p.sold > 20 ? ' 🔥' : '';
    desc += `${num}. *${p.name}*${fire}\n   ➜ Stock: ${p.stock}\n   ➜ Rating: ${p.rating} ⭐\n   ➜ Terjual: ${p.sold} pcs\n   ➜ Harga: Rp.${p.price.toLocaleString('id-ID')}\n${p.description}\n\n`;
    rows.push({ title: `${num}. ${p.name} ${fire}`, id: `order_${p.id}`, description: `Rp.${p.price.toLocaleString('id-ID')} | Stok: ${p.stock}` });
  });
  if (page < totalPages) rows.push({ title: '➡️ Lanjut halaman berikutnya', id: `lanjut_${page + 1}`, description: '' });
  if (page > 1) rows.push({ title: '⬅️ Kembali halaman sebelumnya', id: `lanjut_${page - 1}`, description: '' });
  rows.push({ title: '🔙 Kembali ke Menu Utama', id: 'kembali_menu', description: '' });
  await sock.sendMessage(to, {
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Daftar Produk' },
      body: { text: desc },
      footer: { text: 'GhoziTech - Produk pilihan. Beli sekarang, bayar nanti... eh nggak ding, bayar dulu 😜' },
      action: { button: 'Pilih Produk', sections: [{ title: 'Produk', rows }] }
    }
  });
}

async function sendStockList(sock, to) {
  const products = db.prepare(`SELECT p.name, (SELECT COUNT(*) FROM credentials WHERE product_id=p.id AND is_sold=0) AS stock FROM products p WHERE is_active=1`).all();
  let text = '📦 *Stok Produk GhoziTech*\n\n';
  products.forEach(p => text += `${p.name} ➜ Stock ${p.stock}\n`);
  await sock.sendMessage(to, { text });
}

async function sendCategoryList(sock, to) {
  const cats = db.prepare('SELECT DISTINCT category FROM products WHERE is_active=1').all().map(c => c.category);
  if (!cats.length) return sock.sendMessage(to, { text: 'Belum ada kategori.' });
  const rows = cats.map(c => ({ title: c, id: `kategori_${c}`, description: '' }));
  rows.push({ title: '🔙 Kembali Menu', id: 'kembali_menu', description: '' });
  await sock.sendMessage(to, {
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Kategori Produk' },
      body: { text: '📂 *Kategori Produk*' },
      footer: { text: 'GhoziTech - Pilih kategori favorit lo.' },
      action: { button: 'Pilih', sections: [{ rows }] }
    }
  });
}

async function sendCategoryProducts(sock, to, category) {
  const products = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM credentials WHERE product_id=p.id AND is_sold=0) AS stock FROM products p WHERE category=? AND is_active=1`).all(category);
  if (!products.length) return sock.sendMessage(to, { text: 'Tidak ada produk.' });
  let text = `📂 *${category}*\n\n`;
  const rows = products.map(p => {
    text += `${p.name} - Rp.${p.price.toLocaleString('id-ID')} (Stok: ${p.stock})\n`;
    return { title: p.name, id: `order_${p.id}`, description: `Rp.${p.price.toLocaleString('id-ID')}` };
  });
  rows.push({ title: '🔙 Kembali ke Kategori', id: 'kategori', description: '' });
  await sock.sendMessage(to, {
    interactive: {
      type: 'list',
      header: { type: 'text', text: `Kategori: ${category}` },
      body: { text },
      footer: { text: 'GhoziTech - Pilih produk.' },
      action: { button: 'Pilih', sections: [{ rows }] }
    }
  });
}

async function sendOrderHistory(sock, to) {
  const phone = to.split('@')[0];
  const orders = db.prepare(`SELECT o.id, p.name, o.amount, o.status, o.created_at FROM orders o JOIN products p ON o.product_id=p.id WHERE o.user_phone=? ORDER BY o.id DESC LIMIT 10`).all(phone);
  if (!orders.length) return sock.sendMessage(to, { text: 'Kamu belum pernah order, bestie.' });
  let text = '📜 *Riwayat Order*\n\n';
  orders.forEach(o => text += `#${o.id} - ${o.name} Rp.${o.amount.toLocaleString('id-ID')} (${o.status==='delivered'?'✅':o.status==='paid'?'💰':'⏳'})\n`);
  await sock.sendMessage(to, { text });
}

async function sendCustomerService(sock, to) {
  await sock.sendMessage(to, { text: '📞 *Customer Service GhoziTech*\nHubungi admin di wa.me/6285727688928' });
}

async function sendSettings(sock, to) {
  const rows = [
    { title: '✏️ Ubah Nama', id: 'set_nama', description: '' },
    { title: '📧 Ubah Email', id: 'set_email', description: '' },
    { title: '💳 Ubah Rekening', id: 'set_rekening', description: '' },
    { title: '🔙 Kembali Menu', id: 'kembali_menu', description: '' }
  ];
  await sock.sendMessage(to, {
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Pengaturan Akun' },
      body: { text: '⚙️ *Pengaturan Akun*' },
      footer: { text: 'GhoziTech - Sesuaikan data lo.' },
      action: { button: 'Pilih', sections: [{ rows }] }
    }
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
  sendSettings
};
