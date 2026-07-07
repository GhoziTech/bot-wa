const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const handler = require('./handler');

const app = express();
const PORT = process.env.PORT || 3000;

// Health check untuk UptimeRobot
app.get('/', (req, res) => {
    res.send('Bot is running');
});

app.listen(PORT, () => {
    console.log(`Health check server di port ${PORT}`);
});

// Konfigurasi client WhatsApp
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
            '--disable-features=TranslateUI',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-sync',
            '--disable-background-networking',
            '--disable-default-apps',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--disable-breakpad',
            '--disable-crash-reporter',
            '--disable-dbus'   // tambahan penting
        ],    
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
    }
});

// Event ketika QR muncul
client.on('qr', (qr) => {
    console.log('Scan QR di bawah ini dengan WhatsApp (Linked Devices):\n');
    qrcode.generate(qr, { small: true });
});

// Event ketika bot sudah siap
client.on('ready', () => {
    console.log('✅ Bot berhasil terhubung!');
});

// Event ketika menerima pesan
client.on('message', async (message) => {
    // Hanya proses chat pribadi
    if (message.from === 'status@broadcast' || message.from.includes('@g.us')) return;

    try {
        await handler(client, message);
    } catch (err) {
        console.error('Error handling message:', err);
        await client.sendMessage(message.from, '⚠️ Terjadi kesalahan, silakan coba lagi.');
    }
});

// Mulai bot
client.initialize();
