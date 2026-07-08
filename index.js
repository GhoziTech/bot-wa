const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const handler = require('./handler');
const { handleAdminCommand } = require('./admin');

let baileysModulePromise;
function loadBaileys() {
  if (!baileysModulePromise) baileysModulePromise = import('baileys');
  return baileysModulePromise;
}

const app = express();
const PORT = process.env.PORT || 3000;
const OWNER_PHONE = process.env.OWNER_PHONE || '6285727688928';
const dataDir = path.resolve(process.env.DATA_DIR || __dirname);
const sessionDir = path.resolve(process.env.SESSION_DIR || path.join(dataDir, 'session'));
fs.mkdirSync(sessionDir, { recursive: true });

let latestQR = '';
let isOnline = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let starting = false;

app.use((req, _res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

app.get('/', (_req, res) => {
  if (latestQR) {
    return res.send(`
      <html>
        <head><title>GhoziTech Bot - Scan QR</title></head>
        <body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
          <div style="text-align:center;max-width:500px;">
            <h2>📱 Scan QR dengan WhatsApp Business</h2>
            <img src="${latestQR}" style="border:2px solid #075e54;border-radius:10px;max-width:300px;" />
            <p>Buka WhatsApp Business → Perangkat Tertaut → Tautkan Perangkat.</p>
          </div>
        </body>
      </html>
    `);
  }

  return res.send(`<h2>${isOnline ? '✅ Bot online' : '⏳ Bot sedang menghubungkan...'}</h2>`);
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    whatsapp: isOnline ? 'online' : 'connecting',
    sessionDir,
    uptimeSeconds: Math.floor(process.uptime())
  });
});

app.use((_req, res) => res.redirect('/'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server berjalan di http://0.0.0.0:${PORT}`);
  console.log(`[SESSION] ${sessionDir}`);
});

function unwrapMessage(message = {}) {
  let current = message;
  for (let i = 0; i < 5; i += 1) {
    if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
    else if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
    else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
    else break;
  }
  return current;
}

function extractText(msg) {
  const message = unwrapMessage(msg.message || {});
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  ).trim();
}

function normalizeNumber(jid = '') {
  return jid.split('@')[0].split(':')[0];
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  const delay = Math.min(60_000, 5_000 * (2 ** Math.min(reconnectAttempts - 1, 4)));
  console.log(`🔄 Mencoba koneksi ulang dalam ${Math.round(delay / 1000)} detik...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot().catch((error) => console.error('Gagal reconnect:', error));
  }, delay);
}

async function startBot() {
  if (starting) return;
  starting = true;

  try {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion
    } = await loadBaileys();

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '20.0.0'],
      connectOptions: { maxRetries: 3, timeout: 30_000 },
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        QRCode.toDataURL(qr, (error, url) => {
          if (!error) {
            latestQR = url;
            console.log('📱 QR tersedia. Buka URL Railway lalu scan.');
          }
        });
      }

      if (connection === 'close') {
        latestQR = '';
        isOnline = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        console.log(`Koneksi terputus: ${lastDisconnect?.error?.message || 'unknown'} (${statusCode || '-'})`);

        // Jangan menghapus session otomatis. Ini mencegah bot meminta QR ulang
        // hanya karena gangguan jaringan atau redeploy singkat.
        if (!loggedOut) scheduleReconnect();
        else console.log('⚠️ Session benar-benar logout. Hapus folder session secara manual hanya bila ingin scan ulang.');
      }

      if (connection === 'open') {
        console.log('✅ Bot GhoziTech berhasil terhubung.');
        isOnline = true;
        latestQR = '';
        reconnectAttempts = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (!isOnline || type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;

        try {
          if (msg.key.fromMe) {
            // Pesan admin sehari-hari tidak diproses bot.
            // Hanya command '/' di chat "Message yourself" yang diproses.
            const text = extractText(msg);
            const remoteNumber = normalizeNumber(msg.key.remoteJid);
            const selfNumber = normalizeNumber(sock.user?.id) || OWNER_PHONE;
            const isSelfChat = remoteNumber === selfNumber || remoteNumber === OWNER_PHONE;

            if (isSelfChat && text.startsWith('/')) {
              await handleAdminCommand(sock, msg);
            }
            continue;
          }

          console.log('[INCOMING KEY]', JSON.stringify({ remoteJid: msg.key.remoteJid, remoteJidAlt: msg.key.remoteJidAlt, participant: msg.key.participant, participantAlt: msg.key.participantAlt, addressingMode: msg.key.addressingMode }));
          console.log(`[INCOMING] from ${msg.key.remoteJid}, type: ${Object.keys(unwrapMessage(msg.message))[0]}`);
          await handler(sock, msg);
        } catch (error) {
          console.error('Handler error:', error);
        }
      }
    });
  } finally {
    starting = false;
  }
}

startBot().catch((error) => {
  console.error('Gagal start:', error);
  scheduleReconnect();
});
