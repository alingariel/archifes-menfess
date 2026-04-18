// WHATSAPP STUB - Fitur WhatsApp dinonaktifkan total atas permintaan user
// Fail ini tetap ada hanya untuk mencegah error import pada index.js

export async function connectWhatsApp() {
  console.log('[System] 🚫 Integrasi WhatsApp telah dinonaktifkan sepenuhnya.');
}

export async function sendToChannel(data) {
  console.log('[System] ℹ️ Mencoba mengirim ke WhatsApp, tapi fitur telah dinonaktifkan.');
  return null;
}

export async function sendCommentToChannel(p) { return false; }
export async function deleteFromChannel(id) { return false; }
export function getStatus() { return { connected: false, channelJid: null }; }
export function setChannelJid(jid) { }
