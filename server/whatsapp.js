import pkg from '@whiskeysockets/baileys';
import qrcodeTerminal from 'qrcode-terminal';
import path from 'path';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { existsSync, rmSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: 'silent' });
let sock = null;
let isConnected = false;
let CHANNEL_JID = '120363428902488979@newsletter';

async function connectWhatsApp() {
  console.log('[WA] 🚀 Menjalankan Sistem Klasik (Pairing Code Focus)...');
  
  try {
    const { 
      default: makeWASocket, 
      DisconnectReason, 
      useMultiFileAuthState, 
      makeCacheableSignalKeyStore 
    } = await import('@whiskeysockets/baileys');

    const authPath = path.join(__dirname, 'data', 'wa_auth');
    
    if (process.env.RESET_WA_SESSION === 'true') {
      console.log('[WA] 🧹 Membersihkan sesi lama...');
      if (existsSync(authPath)) rmSync(authPath, { recursive: true, force: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: true,
      logger,
      browser: ['Windows', 'Chrome', '11.0.0'],
      connectTimeoutMs: 60000,
      syncFullHistory: false
    });

    if (!state.creds.registered && process.env.WA_PHONE_NUMBER) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(process.env.WA_PHONE_NUMBER);
          console.log('\n========================================');
          console.log(`📱 PAIRING CODE ANDA: ${code}`);
          console.log('========================================\n');
        } catch (e) {
          console.log('[WA] Gagal minta kode, mungkin perlu restart atau tunggu sejenak.');
        }
      }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('[WA] Terputus, mencoba hubungkan kembali...');
        if (shouldReconnect) connectWhatsApp();
      } else if (connection === 'open') {
        isConnected = true;
        console.log('[WA] ✅ WhatsApp Terhubung!');
      }
    });

    sock.ev.on('creds.update', saveCreds);

  } catch (err) {
    console.error('[WA] Error Fatal:', err);
  }
}

async function sendToChannel(menfessData) {
  if (!isConnected || !sock || !CHANNEL_JID) return false;
  try {
    const message = `${menfessData.content}\n\n💌 ${menfessData.unique_id}\n— ArchiFes`;
    const result = await sock.sendMessage(CHANNEL_JID, { text: message });
    return result.key.id;
  } catch (err) {
    return null;
  }
}

async function deleteFromChannel(messageId) {
  if (!isConnected || !sock || !CHANNEL_JID || !messageId) return false;
  try {
    await sock.sendMessage(CHANNEL_JID, { 
      delete: { remoteJid: CHANNEL_JID, fromMe: true, id: messageId, participant: sock.user.id.split(':')[0] + '@s.whatsapp.net' } 
    });
    return true;
  } catch (err) { return false; }
}

async function sendCommentToChannel(parentUniqueId, parentContent, commentData) {
  if (!isConnected || !sock || !CHANNEL_JID) return false;
  try {
    const message = `💬 *Balasan untuk #${parentUniqueId}:*\n> "${parentContent.substring(0, 50)}..." \n\n${commentData.content}`;
    await sock.sendMessage(CHANNEL_JID, { text: message });
    return true;
  } catch (err) { return false; }
}

function getStatus() { return { connected: isConnected }; }

export { connectWhatsApp, sendToChannel, deleteFromChannel, sendCommentToChannel, getStatus };
