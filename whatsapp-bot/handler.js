const db = require('./database');
const menu = require('./menu');
const { MessageMedia } = require('whatsapp-web.js');
const userStates = new Map();

function getState(phone) {
    if (!userStates.has(phone)) userStates.set(phone, { step: 'idle' });
    return userStates.get(phone);
}

async function handleMessage(client, message) {
    const from = message.from;
    const phone = from.split('@')[0];

    // Ambil nama dari kontak WhatsApp
    let senderName = message._data?.notifyName || message._data?.verifiedBizName || '';
    if (!senderName && message.getContact) {
        try {
            const contact = await message.getContact();
            senderName = contact.pushname || contact.name || '';
        } catch (e) {}
    }

    // Register otomatis
    let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!user) {
        db.prepare('INSERT INTO users (phone, name) VALUES (?, ?)').run(phone, senderName || '');
        user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    }

    // Cek tipe pesan: List Response
    if (message.type === 'list_response') {
        const rowId = message.listResponse?.singleSelectReply?.selectedRowId;
        if (rowId) {
            console.log(`List response ${phone}: ${rowId}`);
            return await handleListAction(client, from, phone, rowId);
        }
    }

    // Teks biasa
    const text = message.body.trim();
    if (!text) return;
    console.log(`Pesan ${phone}: ${text}`);

    const state = getState(phone);

    if (text === '#mulai') {
        userStates.set(phone, { step: 'idle' });
        return await menu.sendMainMenu(client, from);
    }

    // Admin command
    if (phone === '6285727688928' && text.startsWith('/')) {
        const { handleAdminCommand } = require('./admin');
        return await handleAdminCommand(client, message);
    }

    // State handling
    if (['order_confirm','order_payment','isi_saldo','topup_payment','settings_name','settings_email','settings_rekening'].includes(state.step)) {
        return await handleState(client, from, phone, state, text.toLowerCase());
    }

    // Teks yang menyerupai rowId (dari user yang mungkin mengetik manual)
    if (text.startsWith('order_') || text.startsWith('lanjut_') || text.startsWith('kategori_') || ['profile','list_produk','kategori','stock','isi_saldo','order_history','customer_service','settings','kembali_menu','set_nama','set_email','set_rekening'].includes(text)) {
        return await handleListAction(client, from, phone, text);
    }

    // fallback
    await menu.sendMainMenu(client, from);
}

async function handleListAction(client, from, phone, rowId) {
    if (rowId === 'kembali_menu') {
        userStates.set(phone, { step: 'idle' });
        return await menu.sendMainMenu(client, from);
    }
    if (rowId === 'profile') return await menu.sendProfile(client, from);
    if (rowId === 'list_produk') return await menu.sendProductList(client, from, 1);
    if (rowId === 'kategori') return await menu.sendCategoryList(client, from);
    if (rowId === 'stock') return await menu.sendStockList(client, from);
    if (rowId === 'isi_saldo') {
        userStates.set(phone, { step: 'isi_saldo' });
        return client.sendMessage(from, '💰 Masukkan nominal top up (contoh: 50000):');
    }
    if (rowId === 'order_history') return await menu.sendOrderHistory(client, from);
    if (rowId === 'customer_service') return await menu.sendCustomerService(client, from);
    if (rowId === 'settings') return await menu.sendSettings(client, from);
    if (rowId === 'set_nama') {
        userStates.set(phone, { step: 'settings_name' });
        return client.sendMessage(from, '✏️ Masukkan nama baru:');
    }
    if (rowId === 'set_email') {
        userStates.set(phone, { step: 'settings_email' });
        return client.sendMessage(from, '📧 Masukkan email baru:');
    }
    if (rowId === 'set_rekening') {
        userStates.set(phone, { step: 'settings_rekening' });
        return client.sendMessage(from, '💳 Masukkan nomor rekening baru:');
    }
    if (rowId.startsWith('order_')) {
        const productId = parseInt(rowId.split('_')[1]);
        return await initiateOrder(client, from, phone, productId);
    }
    if (rowId.startsWith('lanjut_')) {
        const page = parseInt(rowId.split('_')[1]);
        return await menu.sendProductList(client, from, page);
    }
    if (rowId.startsWith('kategori_')) {
        const category = rowId.substring(9);
        return await menu.sendCategoryProducts(client, from, category);
    }
    await menu.sendMainMenu(client, from);
}

async function handleState(client, from, phone, state, text) {
    if (state.step === 'isi_saldo') {
        const nominal = parseInt(text.replace(/[^0-9]/g, ''));
        if (isNaN(nominal) || nominal < 1000) return client.sendMessage(from, '❌ Nominal tidak valid.');
        userStates.set(phone, { step: 'topup_payment', nominal });
        const media = MessageMedia.fromFilePath('./qris.jpg');
        await client.sendMessage(from, media, { caption: `💳 Top Up Rp ${nominal.toLocaleString('id-ID')}\nScan QRIS lalu balas *Sudah Bayar*.` });
        return;
    }
    if (state.step === 'topup_payment') {
        if (text === 'sudah bayar') {
            const admin = '6285727688928@c.us';
            await client.sendMessage(admin, `🔔 Top Up Saldo dari ${phone} Rp ${state.nominal}\nKetik /topup ${phone} ${state.nominal}`);
            await client.sendMessage(from, '✅ Permintaan top up dikirim ke admin.');
            userStates.set(phone, { step: 'idle' });
        } else if (text === 'batal') {
            userStates.set(phone, { step: 'idle' });
            await menu.sendMainMenu(client, from);
        }
        return;
    }
    if (state.step === 'order_confirm') {
        if (text === 'ya') {
            const product = db.prepare('SELECT * FROM products WHERE id=?').get(state.productId);
            const stock = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE product_id=? AND is_sold=0').get(state.productId).cnt;
            if (stock < 1) {
                userStates.set(phone, { step: 'idle' });
                return client.sendMessage(from, '❌ Stok habis.');
            }
            const result = db.prepare('INSERT INTO orders (user_phone, product_id, amount, status) VALUES (?,?,?,?)').run(phone, state.productId, product.price, 'pending');
            const orderId = result.lastInsertRowid;
            userStates.set(phone, { step: 'order_payment', orderId, productId: state.productId });
            const media = MessageMedia.fromFilePath('./qris.jpg');
            await client.sendMessage(from, media, { caption: `💳 Order #${orderId} - ${product.name}\nTotal: Rp ${product.price.toLocaleString('id-ID')}\nScan QRIS lalu balas *Sudah Bayar*.` });
        } else {
            userStates.set(phone, { step: 'idle' });
            await menu.sendMainMenu(client, from);
        }
        return;
    }
    if (state.step === 'order_payment') {
        if (text === 'sudah bayar') {
            const admin = '6285727688928@c.us';
            await client.sendMessage(admin, `🔔 Pembayaran Order #${state.orderId} dari ${phone}\nKetik /verifikasi ${state.orderId}`);
            await client.sendMessage(from, '✅ Pembayaran diteruskan ke admin. Produk akan dikirim setelah verifikasi.');
            userStates.set(phone, { step: 'idle' });
        } else if (text === 'batal') {
            userStates.set(phone, { step: 'idle' });
            await menu.sendMainMenu(client, from);
        }
        return;
    }
    // Settings
    if (state.step === 'settings_name') {
        db.prepare('UPDATE users SET name=? WHERE phone=?').run(text, phone);
        userStates.set(phone, { step: 'idle' });
        await client.sendMessage(from, '✅ Nama diubah.');
        return await menu.sendProfile(client, from);
    }
    if (state.step === 'settings_email') {
        db.prepare('UPDATE users SET email=? WHERE phone=?').run(text, phone);
        userStates.set(phone, { step: 'idle' });
        await client.sendMessage(from, '✅ Email diubah.');
        return await menu.sendProfile(client, from);
    }
    if (state.step === 'settings_rekening') {
        db.prepare('UPDATE users SET no_rekening=? WHERE phone=?').run(text, phone);
        userStates.set(phone, { step: 'idle' });
        await client.sendMessage(from, '✅ No. Rekening diubah.');
        return await menu.sendProfile(client, from);
    }
}

async function initiateOrder(client, from, phone, productId) {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(productId);
    if (!product) return client.sendMessage(from, '❌ Produk tidak ditemukan.');
    const stock = db.prepare('SELECT COUNT(*) AS cnt FROM credentials WHERE product_id=? AND is_sold=0').get(productId).cnt;
    if (stock < 1) return client.sendMessage(from, '❌ Stok habis.');
    userStates.set(phone, { step: 'order_confirm', productId });
    await client.sendMessage(from, `🛒 *${product.name}*\nHarga: Rp.${product.price.toLocaleString('id-ID')}\nStok: ${stock}\n\nBalas *ya* untuk lanjut bayar, atau *batal*.`);
}

module.exports = handleMessage;