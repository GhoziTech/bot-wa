const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const handler = require('./handler');

const app = express();
const PORT = process.env.PORT || 3000;

// Health check server
app.get('/', (req, res) => {
    res.send('Bot is running');
});

app.listen(PORT, () => {
    console.log(`Health check server di port ${PORT}`);
});

// Inisialisasi WhatsApp Client
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
            '--no-zygote'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
    }
});

// Event saat QR code muncul
client.on('qr', (qr) => {
    console.log('Scan QR di bawah ini dengan WhatsApp (Linked Devices):\n');
    qrcode.generate(qr, { small: true });
});

// Event saat bot siap
client.on('ready', () => {
    console.log('✅ Bot berhasil terhubung!');
});

// Event saat menerima pesan
client.on('message', async (message) => {
    // Abaikan broadcast dan grup
    if (message.from === 'status@broadcast' || message.from.includes('@g.us')) return;

    try {
        await handler(client, message);
    } catch (err) {
        console.error('Error handling message:', err);
        client.sendMessage(message.from, '⚠️ Terjadi kesalahan, coba lagi nanti.');
    }
});

// Mulai bot
client.initialize();
