const db = require('./database');
const { MessageMedia } = require('whatsapp-web.js');

async function handleAdminCommand(client, message) {
    const text = message.body;
    const args = text.slice(1).split(' ');
    const cmd = args[0].toLowerCase();
    const from = message.from;

    if (cmd === 'verifikasi') {
        const orderId = parseInt(args[1]);
        if (!orderId) return client.sendMessage(from, 'Format: /verifikasi <order_id>');
        const order = db.prepare('SELECT * FROM orders WHERE id = ? AND status = ?').get(orderId, 'pending');
        if (!order) return client.sendMessage(from, 'Order tidak ditemukan/sudah diproses.');
        const credential = db.prepare('SELECT * FROM credentials WHERE product_id = ? AND is_sold = 0 ORDER BY id LIMIT 1').get(order.product_id);
        if (!credential) return client.sendMessage(from, 'Stok kredensial habis.');
        db.prepare('UPDATE credentials SET is_sold = 1, order_id = ? WHERE id = ?').run(orderId, credential.id);
        db.prepare('UPDATE orders SET status = ?, credential_id = ? WHERE id = ?').run('delivered', credential.id, orderId);
        db.prepare('UPDATE users SET total_order = total_order + 1, total_pengeluaran = total_pengeluaran + ? WHERE phone = ?').run(order.amount, order.user_phone);
        db.prepare('UPDATE products SET sold = sold + 1 WHERE id = ?').run(order.product_id);
        const buyerJid = order.user_phone + '@c.us';
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(order.product_id);
        await client.sendMessage(buyerJid, `✅ Pesanan #${orderId} Selesai!\nProduk: ${product.name}\n📧 Email: ${credential.email}\n🔑 Password: ${credential.password}`);
        await client.sendMessage(from, `✅ Order #${orderId} terverifikasi & terkirim.`);
    } else if (cmd === 'topup') {
        const phone = args[1];
        const amount = parseInt(args[2]);
        if (!phone || !amount) return client.sendMessage(from, 'Format: /topup <nomor> <jumlah>');
        db.prepare('UPDATE users SET saldo = saldo + ? WHERE phone = ?').run(amount, phone);
        await client.sendMessage(phone + '@c.us', `💰 Saldo bertambah Rp ${amount.toLocaleString('id-ID')}.`);
        await client.sendMessage(from, `✅ Top up ${phone} sebesar ${amount} berhasil.`);
    } else if (cmd === 'addcred') {
        const productId = parseInt(args[1]);
        const email = args[2];
        const password = args.slice(3).join(' ');
        if (!productId || !email || !password) return client.sendMessage(from, 'Format: /addcred <product_id> <email> <password>');
        db.prepare('INSERT INTO credentials (product_id, email, password) VALUES (?, ?, ?)').run(productId, email, password);
        await client.sendMessage(from, '✅ Kredensial ditambahkan.');
    } else if (cmd === 'stock') {
        const products = db.prepare(`SELECT p.id, p.name, (SELECT COUNT(*) FROM credentials WHERE product_id = p.id AND is_sold = 0) AS stock FROM products p`).all();
        let txt = '📦 Stok Produk:\n';
        products.forEach(p => txt += `${p.id}. ${p.name} ➜ ${p.stock}\n`);
        await client.sendMessage(from, txt);
    } else if (cmd === 'addproduct') {
        const name = args[1];
        const price = parseInt(args[2]);
        const category = args[3] || '';
        const desc = args.slice(4).join(' ');
        if (!name || !price) return client.sendMessage(from, 'Format: /addproduct <nama> <harga> <kategori> <deskripsi>');
        db.prepare('INSERT INTO products (name, price, category, description) VALUES (?, ?, ?, ?)').run(name, price, category, desc);
        await client.sendMessage(from, '✅ Produk ditambahkan.');
    }
}

module.exports = { handleAdminCommand };