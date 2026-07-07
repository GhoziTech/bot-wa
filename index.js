const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const handler = require('./handler');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`Health check server di port ${PORT}`));

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['Ubuntu', 'Chrome', '20.0.0'],
    connectOptions: {
      maxRetries: 5,
      timeout: 60000
    }
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('Scan QR di bawah ini dengan WhatsApp (Linked Devices):\n');
      qrcode.generate(qr, { small: true });
      reconnectAttempts = 0;
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`Koneksi terputus. Alasan: ${lastDisconnect?.error?.message || 'unknown'}`);
      console.log(`Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        reconnectAttempts++;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.log('⚠️ Terlalu banyak percobaan gagal. Menghapus session...');
          try { fs.rmSync('session', { recursive: true, force: true }); } catch (err) {}
          reconnectAttempts = 0;
        }
        setTimeout(() => startBot(), 10000);
      } else {
        console.log('Logout terdeteksi. Hapus folder session jika ingin login ulang.');
        reconnectAttempts = 0;
      }
    } else if (connection === 'open') {
      console.log('✅ Bot berhasil terhubung!');
      reconnectAttempts = 0;
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    try {
      await handler(sock, msg);
    } catch (err) {
      console.error('Handler error:', err);
    }
  });
}

startBot().catch(err => console.error('Gagal start:', err));
