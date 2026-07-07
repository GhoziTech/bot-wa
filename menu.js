const db = require('./database');

// Fungsi bantu untuk mengirim list
async function sendList(client, to, title, text, buttonText, sections) {
    await client.sendMessage(to, {
        list: { title, text, buttonText, sections }
    });
}

// MAIN MENU
async function sendMainMenu(client, to) {
    const sections = [
        {
            title: '📌 Menu Utama',
            rows: [
                { title: '👤 Profile', rowId: 'profile', description: 'Lihat profil & saldo' },
                { title: '📦 List Produk', rowId: 'list_produk', description: 'Semua produk' },
                { title: '📂 Kategori', rowId: 'kategori', description: 'Lihat per kategori' },
                { title: '📊 Stock Product', rowId: 'stock', description: 'Stok terkini' },
            ]
        }
    ];
    await sendList(client, to, 'Menu Utama', '✨ Selamat datang di StoreBot!\nKetik #mulai untuk kembali.', 'Pilih Menu', sections);
}

// PROFILE
async function sendProfile(client, to) {
    const phone = to.split('@')[0];
    const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!user) return client.sendMessage(to, '❌ Data tidak ditemukan.');

    let text = `🧑 *Profil Akun*\n\n`;
    text += `📛 Nama: ${user.name || '-'}\n`;
    text += `📞 Phone: ${user.phone}\n`;
    text += `📩 Email: ${user.email || '-'}\n`;
    text += `💰 Saldo: Rp ${user.saldo.toLocaleString('id-ID')}\n`;
    text += `🔢 Total Order: ${user.total_order}\n`;
    text += `🚮 Total Pengeluaran: Rp ${user.total_pengeluaran.toLocaleString('id-ID')}\n`;
    text += `💳 No. Rekening: ${user.no_rekening || '-'}`;

    const sections = [
        {
            rows: [
                { title: '➕ Isi Saldo', rowId: 'isi_saldo', description: '' },
                { title: '📜 Order History', rowId: 'order_history', description: '' },
                { title: '📞 Customer Service', rowId: 'customer_service', description: '' },
                { title: '⚙️ Settings', rowId: 'settings', description: '' },
                { title: '🔙 Kembali Menu', rowId: 'kembali_menu', description: '' }
            ]
        }
    ];
    await sendList(client, to, 'Profile', text, 'Pilih Aksi', sections);
}

// LIST PRODUK DENGAN PAGINATION
async function sendProductList(client, to, page = 1) {
    const perPage = 5;
    const offset = (page - 1) * perPage;
    const products = db.prepare(`
        SELECT p.*, (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND is_sold = 0) AS stock
        FROM products p WHERE p.is_active = 1 ORDER BY p.id LIMIT ? OFFSET ?
    `).all(perPage, offset);
    const total = db.prepare('SELECT COUNT(*) AS count FROM products WHERE is_active = 1').get().count;
    const totalPages = Math.ceil(total / perPage);

    let desc = `📦 *Daftar Semua Produk (${page}/${totalPages})*\n\n`;
    const rows = [];
    products.forEach((p, idx) => {
        const num = offset + idx + 1;
        const fire = p.sold > 20 ? ' 🔥' : '';
        desc += `${num}. *${p.name}*${fire}\n   ➜ Stock: ${p.stock}\n   ➜ Rating: ${p.rating} ⭐\n   ➜ Terjual: ${p.sold} pcs\n   ➜ Harga: Rp.${p.price.toLocaleString('id-ID')}\n${p.description}\n\n`;
        rows.push({
            title: `${num}. ${p.name} ${fire}`,
            rowId: `order_${p.id}`,
            description: `Rp.${p.price.toLocaleString('id-ID')} | Stok: ${p.stock}`
        });
    });

    if (page < totalPages) rows.push({ title: '➡️ Lanjut ke halaman berikutnya', rowId: `lanjut_${page + 1}`, description: '' });
    if (page > 1) rows.push({ title: '⬅️ Kembali ke halaman sebelumnya', rowId: `lanjut_${page - 1}`, description: '' });
    rows.push({ title: '🔙 Kembali ke Menu Utama', rowId: 'kembali_menu', description: '' });

    const sections = [{ title: 'Pilih Produk', rows }];
    await sendList(client, to, 'List Produk', desc, 'Pilih Produk', sections);
}

// STOCK PRODUCT
async function sendStockList(client, to) {
    const products = db.prepare(`SELECT p.id, p.name, (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND is_sold = 0) AS stock FROM products p WHERE p.is_active = 1`).all();
    let text = '📦 *Daftar Stock Product*\n\n';
    products.forEach(p => text += `${p.name} ➜ Stock ${p.stock}\n`);
    const rows = [{ title: '🔙 Kembali Menu', rowId: 'kembali_menu', description: '' }];
    await sendList(client, to, 'Stock', text, 'Menu', [{ rows }]);
}

// KATEGORI LIST
async function sendCategoryList(client, to) {
    const categories = db.prepare('SELECT DISTINCT category FROM products WHERE is_active=1').all().map(c => c.category);
    if (categories.length === 0) return client.sendMessage(to, 'Belum ada kategori.');
    const rows = categories.map(cat => ({ title: cat, rowId: `kategori_${cat}`, description: '' }));
    rows.push({ title: '🔙 Kembali Menu', rowId: 'kembali_menu', description: '' });
    await sendList(client, to, 'Kategori', '📂 *Kategori Produk*', 'Pilih', [{ rows }]);
}

// PRODUK PER KATEGORI
async function sendCategoryProducts(client, to, category) {
    const products = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND is_sold = 0) AS stock FROM products p WHERE p.category=? AND p.is_active=1`).all(category);
    if (products.length === 0) return client.sendMessage(to, 'Tidak ada produk.');
    let text = `📂 *${category}*\n\n`;
    const rows = products.map(p => {
        text += `${p.name} - Rp.${p.price.toLocaleString('id-ID')} (Stok: ${p.stock})\n`;
        return { title: p.name, rowId: `order_${p.id}`, description: `Rp.${p.price.toLocaleString('id-ID')}` };
    });
    rows.push({ title: '🔙 Kembali ke Kategori', rowId: 'kategori', description: '' });
    await sendList(client, to, 'Produk', text, 'Pilih', [{ rows }]);
}

// ORDER HISTORY
async function sendOrderHistory(client, to) {
    const phone = to.split('@')[0];
    const orders = db.prepare(`SELECT o.id, p.name, o.amount, o.status, o.created_at FROM orders o JOIN products p ON o.product_id = p.id WHERE o.user_phone=? ORDER BY o.id DESC LIMIT 10`).all(phone);
    if (orders.length === 0) return client.sendMessage(to, 'Belum ada order.');
    let text = '📜 *Riwayat Order*\n\n';
    orders.forEach(o => text += `#${o.id} - ${o.name} Rp.${o.amount.toLocaleString('id-ID')} (${o.status==='delivered'?'✅':o.status==='paid'?'💰':'⏳'})\n`);
    const rows = [{ title: '🔙 Kembali Menu', rowId: 'kembali_menu', description: '' }];
    await sendList(client, to, 'History', text, 'Menu', [{ rows }]);
}

// CUSTOMER SERVICE
async function sendCustomerService(client, to) {
    await client.sendMessage(to, '📞 *Customer Service*\nHubungi admin: wa.me/6285727688928');
}

// SETTINGS
async function sendSettings(client, to) {
    const rows = [
        { title: '✏️ Ubah Nama', rowId: 'set_nama', description: '' },
        { title: '📧 Ubah Email', rowId: 'set_email', description: '' },
        { title: '💳 Ubah Rekening', rowId: 'set_rekening', description: '' },
        { title: '🔙 Kembali Menu', rowId: 'kembali_menu', description: '' }
    ];
    await sendList(client, to, 'Settings', '⚙️ *Pengaturan Akun*', 'Pilih', [{ rows }]);
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