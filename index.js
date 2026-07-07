const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('baileys');
const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const handler = require('./handler');

const app = express();
const PORT = process.env.PORT || 3000;
let latestQR = '';
let isOnline = false;

app.get('/', (req, res) => {
  if (latestQR) {
    res.send(`
      <html>
        <head><title>GhoziTech Bot - Scan QR</title></head>
        <body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
          <div style="text-align:center;">
            <h2>📱 Scan QR di bawah dengan WhatsApp</h2>
            <img src="${latestQR}" style="border:2px solid #075e54;border-radius:10px;max-width:300px;" />
            <p>Buka WhatsApp &gt; Linked Devices &gt; Link a Device</p>
          </div>
        </body>
      </html>
    `);
  } else {
    res.send('<h2>⏳ QR belum tersedia, atau bot sudah terhubung.</h2>');
  }
});

app.get('/health', (req, res) => res.send('Bot is running'));

const server = app.listen(PORT, '0.0.0.0', () => console.log(`✅ Health server di port ${PORT}`));

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['GhoziTech', 'Chrome', '1.0.0'],
    connectOptions: { maxRetries: 3, timeout: 30000 }
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      QRCode.toDataURL(qr, (err, url) => {
        if (!err) {
          latestQR = url;
          console.log('📱 QR Code tersedia! Buka URL Railway Anda untuk scan.');
        }
      });
    }

    if (connection === 'close') {
      latestQR = '';
      isOnline = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`Koneksi terputus. Alasan: ${lastDisconnect?.error?.message || 'unknown'}`);
      if (shouldReconnect) {
        reconnectAttempts++;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.log('⚠️ Terlalu banyak percobaan gagal. Menghapus session...');
          try { fs.rmSync('session', { recursive: true, force: true }); } catch (err) {}
          reconnectAttempts = 0;
        }
        setTimeout(() => startBot(), 10000);
      } else {
        console.log('Logout terdeteksi.');
        reconnectAttempts = 0;
      }
    } else if (connection === 'open') {
      console.log('✅ Bot GhoziTech berhasil terhubung!');
      isOnline = true;
      latestQR = '';
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
