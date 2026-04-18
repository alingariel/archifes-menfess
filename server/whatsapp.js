import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import path from 'path';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, rmSync } from 'fs';

// Simulasi __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: 'silent' });
let sock = null;
let isConnected = false;
let CHANNEL_JID = null; // Akan dideteksi otomatis
let pairingRequested = false;

// Konfigurasi Dasar
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3001';
const dataDir = path.resolve(__dirname, 'data');
const authPath = path.join(dataDir, 'wa_auth');

// Pastikan folder data ada
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

async function connectWhatsApp() {
  console.log('\n[WA] 🚀 Inisialisasi Bot ArchiFes Baru Dimulai...');
  
  try {
    const { 
      default: makeWASocket, 
      DisconnectReason, 
      useMultiFileAuthState, 
      makeCacheableSignalKeyStore 
    } = await import('@whiskeysockets/baileys');

    // Fitur Reset Sesi
    if (process.env.RESET_WA_SESSION === 'true') {
      console.log('[WA] 🧹 Melakukan pembersihan sesi lama...');
      if (existsSync(authPath)) rmSync(authPath, { recursive: true, force: true });
      const qrFile = path.join(dataDir, 'whatsapp_qr.png');
      if (existsSync(qrFile)) rmSync(qrFile, { force: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    let version = [2, 3000, 1015901307]; // Fallback versi stabil
    try {
      const { version: latestVersion } = await fetchLatestBaileysVersion();
      version = latestVersion;
      console.log(`[WA] 🆕 Menggunakan protokol WhatsApp v${version.join('.')}`);
    } catch (e) {
      console.log('[WA] ⚠️ Gagal mengambil versi terbaru, menggunakan fallback stabil.');
    }

    console.log('[WA] 🔌 Membuka socket koneksi...');
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      browser: ['Windows', 'Edge', '122.0.2365.92'],
      markOnline: true,
      connectTimeoutMs: 120000,
      defaultQueryTimeoutMs: 120000,
      syncFullHistory: false
    });

    // --- EVENT: UPDATE KONEKSI ---
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Tampilkan QR/Kode Pairing jika belum terdaftar
      if (qr && !pairingRequested && !sock.authState.creds.registered) {
        pairingRequested = true;
        console.log('\n========================================');
        console.log('      📟 WHATSAPP PAIRING SESSION');
        console.log('========================================');
        qrcodeTerminal.generate(qr, { small: true });
        
        // Simpan QR ke file untuk preview web
        await QRCode.toFile(path.join(dataDir, 'whatsapp_qr.png'), qr);
        
        // Opsional: Pairing Code via Nomor HP
        if (process.env.WA_PHONE_NUMBER) {
          setTimeout(async () => {
            try {
              const code = await sock.requestPairingCode(process.env.WA_PHONE_NUMBER);
              console.log(`\n📱 PAIRING CODE: ${code}`);
              console.log('========================================\n');
            } catch (e) {
              console.log('[WA] Gagal minta pairing code, gunakan QR di atas.');
            }
          }, 5000);
        }
      }

      if (connection === 'close') {
        const error = lastDisconnect?.error;
        const statusCode = error?.output?.statusCode || error?.code;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log(`[WA] ⚠️ Koneksi Terputus (Status: ${statusCode}). Reconnect: ${shouldReconnect}`);
        isConnected = false;
        if (shouldReconnect) {
          setTimeout(() => connectWhatsApp(), 10000);
        }
      } else if (connection === 'open') {
        isConnected = true;
        pairingRequested = false;
        console.log('\n[WA] ✅ BERHASIL TERHUBUNG KE WHATSAPP!');
        console.log('[WA] 🕵️‍♂️ Memulai deteksi Saluran otomatis...');
      }
    });

    // --- EVENT: AUTO-DETECT CHANNEL (NEWSLETTER) ---
    sock.ev.on('chats.upsert', (chats) => {
      chats.forEach(chat => {
        if (chat.id.endsWith('@newsletter') && !CHANNEL_JID) {
          CHANNEL_JID = chat.id;
          console.log(`\n[WA] 🎯 SALURAN TERDETEKSI: ${chat.id}`);
          console.log('[WA] Bot sekarang siap mengirim Menfess ke Saluran ini.\n');
        }
      });
    });

    sock.ev.on('messages.upsert', (m) => {
      const jid = m.messages[0]?.key?.remoteJid;
      if (jid && jid.endsWith('@newsletter') && !CHANNEL_JID) {
        CHANNEL_JID = jid;
        console.log(`\n[WA] 🎯 SALURAN TERDETEKSI VIA PESAN: ${jid}\n`);
      }
    });

    sock.ev.on('creds.update', saveCreds);

  } catch (err) {
    console.error('[WA] 🚨 Gagal Inisialisasi:', err.message);
  }
}

// Fungsi utama pengiriman Menfess ke Saluran
async function sendToChannel(data) {
  if (!isConnected || !sock || !CHANNEL_JID) {
    console.log('[WA] ⚠️ Pesan gagal kirim: Belum terkoneksi atau Saluran belum terdeteksi.');
    return null;
  }
  try {
    const message = [
      data.content,
      '',
      '• - - - - - - - - - - - - - - -',
      '',
      `💌 #${data.unique_id} (${data.sender_name || 'Anonim'})`,
      `💬 Lihat di: ${BASE_URL}/#${data.unique_id}`,
      '',
      `— ArchiFes Menfess`
    ].join('\n');

    const result = await sock.sendMessage(CHANNEL_JID, { text: message });
    console.log(`[WA] 📨 Menfess #${data.unique_id} terkirim ke Saluran.`);
    return result.key.id;
  } catch (err) {
    console.error('[WA] Gagal kirim ke saluran:', err.message);
    return null;
  }
}

// Fitur Balasan (Komentar)
async function sendCommentToChannel(parentUniqueId, parentContent, commentData) {
  if (!isConnected || !sock || !CHANNEL_JID) return false;
  try {
    const shortParent = parentContent.length > 50 ? parentContent.substring(0, 50) + '...' : parentContent;
    const message = [
      `💬 *Balasan untuk Menfess #${parentUniqueId}:*`,
      `> "${shortParent}"`,
      '',
      commentData.content,
      '',
      `— ArchiFes Menfess`
    ].join('\n');
    await sock.sendMessage(CHANNEL_JID, { text: message });
    return true;
  } catch (err) { return false; }
}

// Fitur Hapus Pesan
async function deleteFromChannel(messageId) {
  if (!isConnected || !sock || !CHANNEL_JID || !messageId) return false;
  try {
    await sock.sendMessage(CHANNEL_JID, { 
      delete: { 
        remoteJid: CHANNEL_JID, 
        fromMe: true, 
        id: messageId,
        participant: sock.user.id.split(':')[0] + '@s.whatsapp.net' 
      } 
    });
    return true;
  } catch (err) { return false; }
}

function getStatus() { return { connected: isConnected, channelJid: CHANNEL_JID }; }

export { connectWhatsApp, sendToChannel, sendCommentToChannel, deleteFromChannel, getStatus };
