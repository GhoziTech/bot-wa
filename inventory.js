const db = require('./database');

function normalizeMode(value) {
  const mode = String(value || 'credential').toLowerCase();
  return ['quantity', 'credential', 'manual'].includes(mode) ? mode : 'credential';
}

function getProductWithStock(productId) {
  return db.prepare(`
    SELECT p.*,
      CASE
        WHEN COALESCE(p.stock_mode, 'credential')='credential'
          THEN (SELECT COUNT(*) FROM credentials c WHERE c.product_id=p.id AND c.is_sold=0)
        ELSE COALESCE(p.stock_qty, 0)
      END AS stock
    FROM products p
    WHERE p.id=? AND p.is_active=1
  `).get(productId);
}

function buildDelivery(product, credential) {
  const mode = normalizeMode(product.stock_mode);
  if (mode === 'credential' && credential) {
    return `📧 Email/User: ${credential.email || '-'}\n🔑 Password/Kode: ${credential.password || '-'}`;
  }
  if (mode === 'quantity' && String(product.delivery_text || '').trim()) {
    return String(product.delivery_text).trim();
  }
  return '';
}

function claimStock(product, orderId) {
  const mode = normalizeMode(product.stock_mode);

  if (mode === 'credential') {
    const credential = db.prepare(`
      SELECT * FROM credentials
      WHERE product_id=? AND is_sold=0
      ORDER BY id LIMIT 1
    `).get(product.id);
    if (!credential) throw new Error('STOCK_EMPTY');

    const claimed = db.prepare(`
      UPDATE credentials
      SET is_sold=1, order_id=?
      WHERE id=? AND is_sold=0
    `).run(orderId, credential.id);
    if (claimed.changes !== 1) throw new Error('STOCK_RACE');

    const remainingStock = db.prepare(`
      SELECT COUNT(*) AS cnt FROM credentials
      WHERE product_id=? AND is_sold=0
    `).get(product.id).cnt;

    return {
      credentialId: credential.id,
      status: 'delivered',
      delivery: buildDelivery(product, credential),
      remainingStock
    };
  }

  const reduced = db.prepare(`
    UPDATE products
    SET stock_qty=stock_qty-1
    WHERE id=? AND stock_qty>0
  `).run(product.id);
  if (reduced.changes !== 1) throw new Error('STOCK_EMPTY');

  const remainingStock = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty;
  const delivery = buildDelivery(product, null);
  if (mode === 'quantity' && delivery) {
    return { credentialId: null, status: 'delivered', delivery, remainingStock };
  }

  return {
    credentialId: null,
    status: 'processing',
    delivery: '',
    remainingStock
  };
}

function errorResult(error) {
  const labels = {
    USER_NOT_FOUND: 'Akun pengguna tidak ditemukan.',
    PRODUCT_NOT_FOUND: 'Produk tidak ditemukan atau tidak aktif.',
    ORDER_NOT_FOUND: 'Order tidak ditemukan atau sudah diproses.',
    BALANCE_LOW: 'Saldo tidak mencukupi.',
    STOCK_EMPTY: 'Stock produk habis.',
    STOCK_RACE: 'Stock baru saja diambil transaksi lain. Silakan ulangi.'
  };
  return { ok: false, code: error.message, error: labels[error.message] || error.message };
}

const buyWithBalanceTransaction = db.transaction((userKey, productId) => {
  const user = db.prepare('SELECT * FROM users WHERE phone=?').get(userKey);
  if (!user) throw new Error('USER_NOT_FOUND');

  const product = getProductWithStock(productId);
  if (!product) throw new Error('PRODUCT_NOT_FOUND');
  if (Number(product.stock) < 1) throw new Error('STOCK_EMPTY');
  if (Number(user.saldo) < Number(product.price)) throw new Error('BALANCE_LOW');

  const inserted = db.prepare(`
    INSERT INTO orders (user_phone, product_id, amount, status, payment_method, paid_at)
    VALUES (?, ?, ?, 'pending', 'saldo', CURRENT_TIMESTAMP)
  `).run(userKey, product.id, product.price);
  const orderId = Number(inserted.lastInsertRowid);

  const fulfillment = claimStock(product, orderId);

  db.prepare(`
    UPDATE orders
    SET status=?, credential_id=?
    WHERE id=?
  `).run(fulfillment.status, fulfillment.credentialId, orderId);

  db.prepare(`
    UPDATE users
    SET saldo=saldo-?,
        total_order=total_order+1,
        total_pengeluaran=total_pengeluaran+?
    WHERE phone=?
  `).run(product.price, product.price, userKey);

  db.prepare('UPDATE products SET sold=sold+1 WHERE id=?').run(product.id);
  db.prepare(`
    INSERT INTO wallet_transactions (user_phone, type, amount, reference)
    VALUES (?, 'purchase', ?, ?)
  `).run(userKey, -Number(product.price), `order:${orderId}`);

  return {
    ok: true,
    orderId,
    product,
    status: fulfillment.status,
    delivery: fulfillment.delivery,
    remainingStock: fulfillment.remainingStock,
    paymentMethod: 'saldo'
  };
});

function buyWithBalance(userKey, productId) {
  try {
    return buyWithBalanceTransaction(userKey, productId);
  } catch (error) {
    return errorResult(error);
  }
}

const verifyPendingOrderTransaction = db.transaction((orderId) => {
  const order = db.prepare(`
    SELECT * FROM orders WHERE id=? AND status='pending'
  `).get(orderId);
  if (!order) throw new Error('ORDER_NOT_FOUND');

  const product = getProductWithStock(order.product_id);
  if (!product) throw new Error('PRODUCT_NOT_FOUND');
  if (Number(product.stock) < 1) throw new Error('STOCK_EMPTY');

  const fulfillment = claimStock(product, orderId);

  db.prepare(`
    UPDATE orders
    SET status=?, credential_id=?, payment_method=COALESCE(payment_method, 'qris'), paid_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(fulfillment.status, fulfillment.credentialId, orderId);

  db.prepare(`
    UPDATE users
    SET total_order=total_order+1,
        total_pengeluaran=total_pengeluaran+?
    WHERE phone=?
  `).run(order.amount, order.user_phone);

  db.prepare('UPDATE products SET sold=sold+1 WHERE id=?').run(product.id);

  return {
    ok: true,
    orderId,
    order,
    product,
    status: fulfillment.status,
    delivery: fulfillment.delivery,
    remainingStock: fulfillment.remainingStock,
    paymentMethod: order.payment_method || 'qris'
  };
});

function verifyPendingOrder(orderId) {
  try {
    return verifyPendingOrderTransaction(orderId);
  } catch (error) {
    return errorResult(error);
  }
}

const completeProcessingOrderTransaction = db.transaction((orderId, deliveryText) => {
  const order = db.prepare(`
    SELECT o.*, p.name AS product_name
    FROM orders o JOIN products p ON p.id=o.product_id
    WHERE o.id=? AND o.status='processing'
  `).get(orderId);
  if (!order) throw new Error('ORDER_NOT_FOUND');

  db.prepare("UPDATE orders SET status='delivered' WHERE id=?").run(orderId);
  return {
    ok: true,
    orderId,
    order,
    product: { name: order.product_name },
    status: 'delivered',
    delivery: String(deliveryText || '').trim()
  };
});

function completeProcessingOrder(orderId, deliveryText) {
  try {
    return completeProcessingOrderTransaction(orderId, deliveryText);
  } catch (error) {
    return errorResult(error);
  }
}

function customerMessage(result) {
  if (!result?.ok) return '';

  if (result.status === 'processing') {
    return `✅ *PEMBAYARAN TERVERIFIKASI*\n\n🧾 Order: #${result.orderId}\n📦 Produk: ${result.product.name}\n\nPesanan sudah masuk antrean proses. Admin akan mengirimkan data aktivasi setelah produk siap. Simpan nomor order ini untuk garansi dan bantuan.`;
  }

  return `✅ *PESANAN #${result.orderId} SELESAI*\n\n📦 Produk: ${result.product.name}\n💳 Pembayaran: ${String(result.paymentMethod || '-').toUpperCase()}\n\n*DATA PRODUK / AKTIVASI*\n${result.delivery || 'Produk berhasil diproses.'}\n\nSimpan pesan ini selama masa garansi. Kirim *#mulai* untuk membuka menu bot.`;
}

module.exports = {
  normalizeMode,
  getProductWithStock,
  buyWithBalance,
  verifyPendingOrder,
  completeProcessingOrder,
  customerMessage
};
