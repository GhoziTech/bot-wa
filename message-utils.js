function truncate(value, max) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function listFallback({ title, text, footer, sections }) {
  const rows = sections.flatMap((section) => section.rows || []);
  const options = rows
    .map((row, index) => `${index + 1}. ${row.title}${row.description ? `\n   ${row.description}` : ''}\n   Ketik: ${row.rowId}`)
    .join('\n');

  return [`*${title}*`, text, options, footer].filter(Boolean).join('\n\n');
}

async function sendList(sock, to, payload) {
  const sections = (payload.sections || []).map((section) => ({
    title: truncate(section.title, 24),
    rows: (section.rows || []).map((row) => ({
      title: truncate(row.title, 24),
      rowId: String(row.rowId),
      description: truncate(row.description || '', 72)
    }))
  }));

  try {
    return await sock.sendMessage(to, {
      title: truncate(payload.title || 'Menu', 60),
      text: payload.text || '',
      footer: truncate(payload.footer || '', 60),
      buttonText: truncate(payload.buttonText || 'Buka Menu', 20),
      sections
    });
  } catch (error) {
    console.error('[INTERACTIVE LIST FALLBACK]', error?.message || error);
    return sock.sendMessage(to, {
      text: listFallback({ ...payload, sections })
    });
  }
}

async function sendButtons(sock, to, payload) {
  const buttons = (payload.buttons || []).slice(0, 3).map((button) => ({
    buttonId: String(button.id),
    buttonText: { displayText: truncate(button.text, 20) },
    type: 1
  }));

  try {
    return await sock.sendMessage(to, {
      text: payload.text || '',
      footer: truncate(payload.footer || '', 60),
      buttons,
      headerType: 1
    });
  } catch (error) {
    console.error('[QUICK BUTTON FALLBACK]', error?.message || error);
    const fallback = buttons
      .map((button, index) => `${index + 1}. ${button.buttonText.displayText} — ketik: ${button.buttonId}`)
      .join('\n');
    return sock.sendMessage(to, {
      text: [payload.text, fallback, payload.footer].filter(Boolean).join('\n\n')
    });
  }
}

module.exports = { sendList, sendButtons, truncate };
