let baileysPromise;

function loadBaileys() {
  if (!baileysPromise) baileysPromise = import('baileys');
  return baileysPromise;
}

function truncate(value, max) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function normalizeQuickButtons(buttons = []) {
  return buttons.slice(0, 3).map((button) => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: truncate(button.text, 20),
      id: String(button.id)
    })
  }));
}

function normalizeSections(sections = []) {
  let remaining = 10;
  const result = [];

  for (const section of sections) {
    if (remaining <= 0) break;
    const rows = [];

    for (const row of section.rows || []) {
      if (remaining <= 0) break;
      rows.push({
        id: String(row.id ?? row.rowId),
        title: truncate(row.title, 24),
        description: truncate(row.description || '', 72),
        ...(row.header ? { header: truncate(row.header, 24) } : {})
      });
      remaining -= 1;
    }

    if (rows.length) {
      result.push({
        title: truncate(section.title || 'Pilihan', 24),
        rows
      });
    }
  }

  return result;
}

async function relayNativeInteractive(sock, to, payload) {
  const { proto, generateWAMessageFromContent } = await loadBaileys();
  const nativeButtons = payload.nativeButtons || [];

  if (!to || !nativeButtons.length) {
    throw new Error('Tujuan dan tombol interaktif wajib tersedia.');
  }

  const content = {
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2
        },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          header: proto.Message.InteractiveMessage.Header.create({
            title: truncate(payload.title || '', 60),
            subtitle: '',
            hasMediaAttachment: false
          }),
          body: proto.Message.InteractiveMessage.Body.create({
            text: payload.text || ''
          }),
          footer: proto.Message.InteractiveMessage.Footer.create({
            text: truncate(payload.footer || '', 60)
          }),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
            buttons: nativeButtons,
            messageParamsJson: '{}'
          })
        })
      }
    }
  };

  const generated = generateWAMessageFromContent(to, content, {
    userJid: sock.user?.id || ''
  });

  console.log(`[OUTBOUND INTERACTIVE] to=${to} id=${generated.key.id}`);
  await sock.relayMessage(to, generated.message, {
    messageId: generated.key.id
  });
  console.log(`[OUTBOUND INTERACTIVE RELAYED] to=${to} id=${generated.key.id}`);

  return generated;
}

async function sendQuickButtons(sock, to, payload) {
  return relayNativeInteractive(sock, to, {
    title: payload.title,
    text: payload.text,
    footer: payload.footer,
    nativeButtons: normalizeQuickButtons(payload.buttons)
  });
}

async function sendSingleSelect(sock, to, payload) {
  const sections = normalizeSections(payload.sections);
  const nativeButtons = [
    {
      name: 'single_select',
      buttonParamsJson: JSON.stringify({
        title: truncate(payload.buttonText || 'Pilih Menu', 20),
        sections
      })
    },
    ...normalizeQuickButtons(payload.quickButtons || [])
  ];

  return relayNativeInteractive(sock, to, {
    title: payload.title,
    text: payload.text,
    footer: payload.footer,
    nativeButtons
  });
}

module.exports = {
  sendQuickButtons,
  sendSingleSelect,
  truncate
};
