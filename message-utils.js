function unwrapMessage(message = {}) {
  let current = message;
  for (let index = 0; index < 6; index += 1) {
    if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
    else if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
    else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
    else if (current.documentWithCaptionMessage?.message) current = current.documentWithCaptionMessage.message;
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

function jidDigits(jid = '') {
  return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
}

async function resolveChatIdentity(sock, msg) {
  const key = msg.key || {};
  const remote = key.remoteJid || '';
  const alt = key.remoteJidAlt || key.participantAlt || '';

  // Balasan harus mengikuti alamat percakapan masuk. Jika pesan masuk memakai LID,
  // jangan paksa pengiriman ke PN karena dapat ditolak secara asynchronous.
  let replyJid = remote;

  if (remote.endsWith('@s.whatsapp.net')) {
    try {
      const mappedLid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(remote);
      if (mappedLid) replyJid = mappedLid;
    } catch (error) {
      console.warn('[PN->LID MAP]', error?.message || error);
    }
  }

  let phoneJid = alt.endsWith('@s.whatsapp.net') ? alt : '';
  if (!phoneJid && remote.endsWith('@s.whatsapp.net')) phoneJid = remote;

  if (!phoneJid && remote.endsWith('@lid')) {
    try {
      phoneJid = await sock.signalRepository?.lidMapping?.getPNForLID?.(remote) || '';
    } catch (error) {
      console.warn('[LID->PN MAP]', error?.message || error);
    }
  }

  const phone = jidDigits(phoneJid);
  const userKey = phone || `lid:${jidDigits(remote)}`;
  const displayPhone = phone || remote;

  console.log(`[ROUTE] inbound=${remote} alt=${alt || '-'} outbound=${replyJid} user=${userKey}`);
  return {
    replyJid: replyJid || remote,
    userKey,
    displayPhone
  };
}

function getOwnerJid(sock) {
  if (process.env.OWNER_JID) return process.env.OWNER_JID;
  if (sock.user?.lid) return sock.user.lid;
  const ownerPhone = String(process.env.OWNER_PHONE || '6285727688928').replace(/\D/g, '');
  const selfPhone = jidDigits(sock.user?.id);
  return `${selfPhone || ownerPhone}@s.whatsapp.net`;
}

module.exports = {
  unwrapMessage,
  extractText,
  jidDigits,
  resolveChatIdentity,
  getOwnerJid
};
