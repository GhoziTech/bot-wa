const db = require('./database');

async function handleAdminCommand(sock, msg) {
  const from = msg.key.remoteJid;
  const message = msg.message || {};
  const text = (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    ''
  ).trim();

  if (!text) return;
  const args = text.slice(1).trim().split(/\s+/);
  const cmd = (args[0] || '').toLowerCase();

  if (cmd === 'verifikasi') {
    const orderId = Number.parseInt(args[1], 10);
    if (!orderId) return sock.sendMessage(from, { text: 'Format: /verifikasi <order_id>' });

    const transaction = db.transaction(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id=? AND status=?').get(orderId, 'pending');
      if (!order) return { error: 'Order tidak ditemukan atau sudah diproses.' };

      const cred = db.prepare('SELECT * FROM credentials WHERE product_id=? AND is_sold=0 ORDER BY id LIMIT 1').get(order.product_id);
      if (!cred) return { error: 'Stok kredensial habis.' };

      const claimed = db.prepare('UPDATE credentials SET is_sold=1, order_id=? WHERE id=? AND is_sold=0').run(orderId, cred.id);
      if (claimed.changes !== 1) return { error: 'Stok baru saja diambil order lain. Ulangi.' };

      db.prepare('UPDATE orders SET status=?, credential_id=? WHERE id=?').run('delivered', cred.id, orderId);
      db.prepare('UPDATE users SET total_order=total_order+1, total_pengeluaran=total_pengeluaran+? WHERE phone=?').run(order.amount, order.user_phone);
      db.prepare('UPDATE products SET sold=sold+1 WHERE id=?').run(order.product_id);
      const product = db.prepare('SELECT * FROM products WHERE id=?').get(order.product_id);

      return { order, cred, product };
    });

    const result = transaction();
    if (result.error) return sock.sendMessage(from, { text: `❌ ${result.error}` });

    const buyerJid = `${result.order.user_phone}@s.whatsapp.net`;
    await sock.sendMessage(buyerJid, {
      text: `✅ Pesanan #${orderId} selesai.\nProduk: ${result.product.name}\n📧 Email: ${result.cred.email || '-'}\n🔑 Password/Kode: ${result.cred.password || '-'}`
    });
    return sock.sendMessage(from, { text: `✅ Order #${orderId} terverifikasi dan terkirim.` });
  }

  if (cmd === 'topup') {
    const phone = args[1];
    const amount = Number.parseInt(args[2], 10);
    if (!phone || !amount) return sock.sendMessage(from, { text: 'Format: /topup <nomor> <jumlah>' });

    const result = db.prepare('UPDATE users SET saldo=saldo+? WHERE phone=?').run(amount, phone);
    if (!result.changes) return sock.sendMessage(from, { text: '❌ Pengguna tidak ditemukan.' });

    await sock.sendMessage(`${phone}@s.whatsapp.net`, {
      text: `💰 Saldo bertambah Rp ${amount.toLocaleString('id-ID')}.`
    });
    return sock.sendMessage(from, { text: `✅ Top up ${phone} sebesar Rp ${amount.toLocaleString('id-ID')} berhasil.` });
  }

  if (cmd === 'addcred') {
    const productId = Number.parseInt(args[1], 10);
    const email = args[2];
    const password = args.slice(3).join(' ');
    if (!productId || !email || !password) {
      return sock.sendMessage(from, { text: 'Format: /addcred <product_id> <email> <password/kode>' });
    }

    const product = db.prepare('SELECT id FROM products WHERE id=?').get(productId);
    if (!product) return sock.sendMessage(from, { text: '❌ Produk tidak ditemukan.' });

    db.prepare('INSERT INTO credentials (product_id, email, password) VALUES (?,?,?)').run(productId, email, password);
    return sock.sendMessage(from, { text: '✅ Stok berhasil ditambahkan.' });
  }

  if (cmd === 'help') {
    return sock.sendMessage(from, {
      text: '*ADMIN COMMAND*\n/verifikasi <order_id>\n/topup <nomor> <jumlah>\n/addcred <product_id> <email> <password/kode>'
    });
  }
}

module.exports = { handleAdminCommand };
