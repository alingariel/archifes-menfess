import qrcodeTerminal from 'qrcode-terminal';
import path from 'path';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { existsSync, rmSync } from 'fs';

// Simulasi __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: 'silent' });
let sock = null;
let isConnected = false;
let CHANNEL_JID = '120363428902488979@newsletter';

async function connectWhatsApp() {
  console.log('[WA] 🚀 Menjalankan Sistem Klasik Stabil...');
  
  try {
    const { 
      default: makeWASocket, 
      DisconnectReason, 
      useMultiFileAuthState, 
      makeCacheableSignalKeyStore 
    } = await import('@whiskeysockets/baileys');

    const authPath = path.join(__dirname, 'data', 'wa_auth');
    
    if (process.env.RESET_WA_SESSION === 'true') {
      console.log('[WA] 🧹 Pembersihan Sesi Total...');
      if (existsSync(authPath)) rmSync(authPath, { recursive: true, force: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      // Gunakan identitas Chrome yang lebih standar
      browser: ['Windows', 'Chrome', '121.0.6167.85'],
      connectTimeoutMs: 120000,
      defaultQueryTimeoutMs: 120000,
      syncFullHistory: false
    });

    // MINTA PAIRING CODE (Jika belum terdaftar)
    if (!state.creds.registered && process.env.WA_PHONE_NUMBER) {
      console.log(`[WA] 📟 Meminta Pairing Code untuk: ${process.env.WA_PHONE_NUMBER}...`);
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(process.env.WA_PHONE_NUMBER);
          console.log('\n========================================');
          console.log('      📱 WHATSAPP PAIRING CODE');
          console.log('========================================');
          console.log(`\n           ${code}\n`);
          console.log('========================================');
          console.log('  Masukkan kode di atas di WhatsApp HP Anda');
          console.log('========================================\n');
        } catch (e) {
          console.log('[WA] ⚠️ Gagal mendapatkan kode. Pastikan nomor benar & internet stabil.');
        }
      }, 7000); // Beri jeda 7 detik agar koneksi mantap dulu
    }

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      
      if (connection === 'close') {
        const error = lastDisconnect?.error;
        const statusCode = error?.output?.statusCode || error?.code;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log(`[WA] ⚠️ Terputus (Status: ${statusCode}). Tunggu 10 detik sebelum coba lagi...`);
        isConnected = false;
        
        if (shouldReconnect) {
          setTimeout(() => connectWhatsApp(), 10000); // Jeda 10 detik (Rem Re-koneksi)
        } else {
          console.log('[WA] ❌ Sesi Keluar. Silakan Reset Sesi lewat Railway.');
        }
      } else if (connection === 'open') {
        isConnected = true;
        console.log('[WA] ✅ BERHASIL TERHUBUNG!');
      }
    });

    sock.ev.on('creds.update', saveCreds);

  } catch (err) {
    console.error('[WA] 🚨 Gagal Inisialisasi:', err.message);
  }
}

// Dummy functions untuk kompatibilitas index.js
async function sendToChannel(menfessData) { return false; }
async function deleteFromChannel(messageId) { return false; }
async function sendCommentToChannel(p) { return false; }
function getStatus() { return { connected: isConnected }; }

export { connectWhatsApp, sendToChannel, deleteFromChannel, sendCommentToChannel, getStatus };
