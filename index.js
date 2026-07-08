const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const handler = require('./handler');
const { handleAdminCommand } = require('./admin');
const { extractText, jidDigits } = require('./message-utils');

let baileysPromise;
function loadBaileys() {
  if (!baileysPromise) baileysPromise = import('baileys');
  return baileysPromise;
}

const app = express();
const PORT = process.env.PORT || 3000;
const OWNER_PHONE = String(process.env.OWNER_PHONE || '6285727688928').replace(/\D/g, '');
const dataDir = path.resolve(process.env.DATA_DIR || __dirname);
const sessionDir = path.resolve(process.env.SESSION_DIR || path.join(dataDir, 'session'));
fs.mkdirSync(sessionDir, { recursive: true });

let latestQR = '';
let isOnline = false;
let starting = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
const botOutboundIds = new Set();

app.get('/', (_req, res) => {
  if (latestQR) {
    return res.send(`
      <html>
        <head><title>GhoziTech Bot</title></head>
        <body style="display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:Arial,sans-serif;background:#f5f7f6;">
          <div style="text-align:center;background:white;padding:28px;border-radius:18px;box-shadow:0 10px 40px rgba(0,0,0,.12);">
            <h2>📱 Hubungkan WhatsApp Business</h2>
            <img src="${latestQR}" style="max-width:300px;border:2px solid #075e54;border-radius:12px;" />
            <p>Buka WhatsApp Business → Perangkat Tertaut → Tautkan Perangkat.</p>
          </div>
        </body>
      </html>
    `);
  }
  return res.send(`<h2>${isOnline ? '✅ GhoziTech Bot online' : '⏳ Bot sedang menghubungkan...'}</h2>`);
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    whatsapp: isOnline ? 'online' : 'connecting',
    menu: 'number-only',
    sessionDir,
    uptimeSeconds: Math.floor(process.uptime())
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server berjalan pada port ${PORT}`);
  console.log(`[SESSION] ${sessionDir}`);
});

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  const delay = Math.min(60_000, 5_000 * (2 ** Math.min(reconnectAttempts - 1, 4)));
  console.log(`🔄 Reconnect dalam ${Math.round(delay / 1000)} detik...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot().catch((error) => console.error('Gagal reconnect:', error));
  }, delay);
}

function isKnownAdminCommand(text) {
  return /^\/(verifikasi|topup|addcred|help)\b/i.test(String(text || '').trim());
}

function isOwnerSelfChat(_sock, msg) {
  const configuredSelfJid = process.env.ADMIN_SELF_JID || '';
  if (configuredSelfJid && msg.key?.remoteJid === configuredSelfJid) return true;

  const candidates = [
    msg.key?.remoteJid,
    msg.key?.remoteJidAlt,
    msg.key?.participant,
    msg.key?.participantAlt
  ].map(jidDigits).filter(Boolean);
  return candidates.includes(OWNER_PHONE);
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
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectOptions: { maxRetries: 3, timeout: 30_000 }
    });

    // Catat ID pesan yang dikirim bot agar tidak disalahartikan sebagai command admin.
    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (...args) => {
      const result = await originalSendMessage(...args);
      if (result?.key?.id) {
        botOutboundIds.add(result.key.id);
        setTimeout(() => botOutboundIds.delete(result.key.id), 10 * 60 * 1000).unref?.();
      }
      return result;
    };

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        QRCode.toDataURL(qr, (error, url) => {
          if (!error) {
            latestQR = url;
            console.log('📱 QR tersedia di URL Railway.');
          }
        });
      }

      if (connection === 'open') {
        latestQR = '';
        isOnline = true;
        reconnectAttempts = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        console.log('✅ Bot GhoziTech berhasil terhubung.');
      }

      if (connection === 'close') {
        latestQR = '';
        isOnline = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        console.log(`Koneksi terputus: ${lastDisconnect?.error?.message || 'unknown'} (${statusCode || '-'})`);
        if (!loggedOut) scheduleReconnect();
        else console.log('⚠️ Session logout. Hapus session secara manual hanya jika ingin scan ulang.');
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.update', (updates) => {
      for (const update of updates || []) {
        const status = update.update?.status;
        const stub = update.update?.messageStubParameters;
        if (status !== undefined || stub) {
          console.log('[MESSAGE UPDATE]', JSON.stringify({
            id: update.key?.id,
            remoteJid: update.key?.remoteJid,
            status,
            messageStubParameters: stub
          }));
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (!isOnline || type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;

        try {
          if (msg.key.fromMe) {
            if (botOutboundIds.has(msg.key.id)) continue;
            const text = extractText(msg);
            if (isKnownAdminCommand(text) && isOwnerSelfChat(sock, msg)) {
              await handleAdminCommand(sock, msg);
            }
            continue;
          }

          console.log('[INCOMING KEY]', JSON.stringify({
            remoteJid: msg.key.remoteJid,
            remoteJidAlt: msg.key.remoteJidAlt,
            addressingMode: msg.key.addressingMode
          }));
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
