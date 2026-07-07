const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const express = require('express');
const handler = require('./handler');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`Health check server di port ${PORT}`));

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('session');
  const sock = makeWASocket({
    auth: state,
    browser: ['MyBot', 'Chrome', '1.0.0']
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('Scan QR di bawah ini dengan WhatsApp (Linked Devices):\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom) ?
        lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
      if (shouldReconnect) setTimeout(startBot, 5000);
      else console.log('Logout. Hapus folder session dan deploy ulang.');
    } else if (connection === 'open') {
      console.log('✅ Bot berhasil terhubung!');
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
