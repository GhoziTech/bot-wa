const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const handler = require('./handler');

const app = express();
const PORT = process.env.PORT || 3000;

// HTTP health check (untuk UptimeRobot)
app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.listen(PORT, () => {
  console.log(`Health check server di port ${PORT}`);
});

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: 'session' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--no-zygote',
            // Hindari single-process
            // '--single-process',  <-- JANGAN DIPAKAI
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
    }
});
});

client.on('qr', (qr) => {
    console.log('Scan QR di bawah ini dengan WhatsApp (Linked Devices):\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Bot berhasil terhubung!');
});

client.on('message', async (message) => {
    if (message.from === 'status@broadcast' || message.from.includes('@g.us')) return;
    try {
        await handler(client, message);
    } catch (err) {
        console.error('Error:', err);
        client.sendMessage(message.from, '⚠️ Terjadi kesalahan, coba lagi.');
    }
});

client.initialize();
