const db = require('./database');

async function handleAdminCommand(sock, msg) {
  const from = msg.key.remoteJid;
  const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
  if (!text) return;
  const args = text.slice(1).split(' ');
  const cmd = args[0].toLowerCase();

  if (cmd === 'verifikasi') {
    const orderId = parseInt(args[1]);
    if (!orderId) return sock.sendMessage(from, { text: 'Format: /verifikasi <order_id>' });
    const order = db.prepare('SELECT * FROM orders WHERE id=? AND status=?').get(orderId, 'pending');
    if (!order) return sock.sendMessage(from, { text: 'Order tidak ditemukan/sudah diproses.' });
    const cred = db.prepare('SELECT * FROM credentials WHERE product_id=? AND is_sold=0 ORDER BY id LIMIT 1').get(order.product_id);
    if (!cred) return sock.sendMessage(from, { text: 'Stok kredensial habis.' });
    db.prepare('UPDATE credentials SET is_sold=1, order_id=? WHERE id=?').run(orderId, cred.id);
    db.prepare('UPDATE orders SET status=?, credential_id=? WHERE id=?').run('delivered', cred.id, orderId);
    db.prepare('UPDATE users SET total_order=total_order+1, total_pengeluaran=total_pengeluaran+? WHERE phone=?').run(order.amount, order.user_phone);
    db.prepare('UPDATE products SET sold=sold+1 WHERE id=?').run(order.product_id);
    const buyerJid = order.user_phone + '@s.whatsapp.net';
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(order.product_id);
    await sock.sendMessage(buyerJid, { text: `✅ Pesanan #${orderId} Selesai!\nProduk: ${product.name}\n📧 Email: ${cred.email}\n🔑 Password: ${cred.password}` });
    await sock.sendMessage(from, { text: `✅ Order #${orderId} terverifikasi & terkirim.` });
  } else if (cmd === 'topup') {
    const phone = args[1], amount = parseInt(args[2]);
    if (!phone || !amount) return sock.sendMessage(from, { text: 'Format: /topup <nomor> <jumlah>' });
    db.prepare('UPDATE users SET saldo=saldo+? WHERE phone=?').run(amount, phone);
    await sock.sendMessage(phone + '@s.whatsapp.net', { text: `💰 Saldo bertambah Rp ${amount.toLocaleString('id-ID')}.` });
    await sock.sendMessage(from, { text: `✅ Top up ${phone} sebesar ${amount} berhasil.` });
  } else if (cmd === 'addcred') {
    const productId = parseInt(args[1]), email = args[2], password = args.slice(3).join(' ');
    if (!productId || !email || !password) return sock.sendMessage(from, { text: 'Format: /addcred <product_id> <email> <password>' });
    db.prepare('INSERT INTO credentials (product_id, email, password) VALUES (?,?,?)').run(productId, email, password);
    await sock.sendMessage(from, { text: '✅ Kredensial ditambahkan.' });
  }
}

module.exports = { handleAdminCommand };
