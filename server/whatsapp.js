import pkg from '@whiskeysockets/baileys';
// Kita akan melakukan import dinamis di dalam fungsi untuk kompatibilitas maksimal
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import path from 'path';
import pino from 'pino';
import { fileURLToPath } from 'url';

// Simulasi __dirname di ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { mkdirSync, existsSync, rmSync } from 'fs';

const logger = pino({ level: 'silent' });

let sock = null;
let isConnected = false;
let CHANNEL_JID = '120363428902488979@newsletter';
let pairingRequested = false;

const PHONE_NUMBER = process.env.WA_PHONE_NUMBER || '628123456789'; // Masukkan nomor HP Anda di Variables Railway
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3001';

async function connectWhatsApp() {
  console.log('[WA] 🚀 Inisialisasi bot dimulai...');
  try {
    const { 
      default: makeWASocket, 
      DisconnectReason, 
      useMultiFileAuthState, 
      makeCacheableSignalKeyStore,
      fetchLatestBaileysVersion 
    } = await import('@whiskeysockets/baileys');

    const authPath = path.join(__dirname, 'data', 'wa_auth');
  
    // Fitur Reset: Hapus folder sesi jika diminta lewat Environment Variables
    if (process.env.RESET_WA_SESSION === 'true') {
      console.log('[WA] 🛠️  Mereset sesi WhatsApp atas permintaan user...');
      try {
        if (existsSync(authPath)) {
          rmSync(authPath, { recursive: true, force: true });
          console.log('[WA] ✅ Folder wa_auth berhasil dibersihkan.');
        }
        const qrPath = path.join(__dirname, 'data', 'whatsapp_qr.png');
        if (existsSync(qrPath)) {
          rmSync(qrPath, { force: true });
          console.log('[WA] ✅ File QR lama berhasil dibersihkan.');
        }
      } catch (err) {
        console.error('[WA] ❌ Gagal mereset sesi:', err.message);
      }
    }

    console.log('[WA] 📂 Memuat database sesi...');
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    console.log('[WA] 🔌 Membuka socket koneksi...');
    sock = makeWASocket({
      version: [2, 3000, 1015901307], // Gunakan versi stabil yang diketahui bekerja
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      browser: ['Mac OS', 'Chrome', '121.0.0.0'],
      markOnline: true,
      connectTimeoutMs: 120000, // Tingkatkan ke 120 detik untuk keandalan
      retryRequestDelayMs: 5000,
      defaultQueryTimeoutMs: 90000,
      keepAliveIntervalMs: 10000,
      syncFullHistory: false,
    });

    // Event: Connection Update
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Tampilkan QR jika muncul DAN belum pernah request pairing
      if (qr && !pairingRequested && !sock.authState.creds.registered) {
        pairingRequested = true;
        
        console.log('\n========================================');
        console.log(`  WHATSAPP PAIRING - [${new Date().toLocaleTimeString()}]`);
        console.log('========================================\n');
        qrcodeTerminal.generate(qr, { small: true });
        
        // Save QR to file for easier scanning
        QRCode.toFile(path.join(__dirname, 'data', 'whatsapp_qr.png'), qr, (err) => {
          if (err) console.error('[WA] Gagal simpan file QR:', err);
          else console.log('[WA] 🖼️  QR Code disimpan ke: data/whatsapp_qr.png (Silakan buka file ini untuk scan)');
        });

        console.log('\n  Scan QR di atas dari WhatsApp > Perangkat Tertaut > Tautkan Perangkat');
        
        // Peringatan pairing code
        if (process.env.WA_PHONE_NUMBER) {
          try {
            // Beri jeda 3 detik agar sistem siap
            await new Promise(resolve => setTimeout(resolve, 3000));
            const code = await sock.requestPairingCode(PHONE_NUMBER);
            console.log('\n========================================');
            console.log('      📱 WHATSAPP PAIRING CODE');
            console.log('========================================');
            console.log(`\n           ${code}\n`);
            console.log('========================================');
            console.log('  Masukkan kode di atas pada WhatsApp HP:');
            console.log('  Tautkan Perangkat > Tautkan dengan nomor');
            console.log('========================================\n');
          } catch (err) {
            console.log('  ⚠️  Pairing code gagal/timeout, gunakan QR code.\n');
          }
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.code;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log(`[WA] ⚠️ Koneksi Terputus!`);
        console.log(`[WA] Status Code: ${statusCode}`);
        console.log(`[WA] Reason:`, JSON.stringify(lastDisconnect?.error, null, 2));
        
        isConnected = false;
        pairingRequested = false;
        if (shouldReconnect) {
          setTimeout(() => connectWhatsApp(), 5000);
        } else {
          console.log('[WA] ❌ Logged out. Hapus folder wa_auth lalu restart.');
        }
      } else if (connection === 'open') {
        isConnected = true;
        pairingRequested = false;
        console.log('[WA] ✅ Berhasil terhubung ke WhatsApp!');
        setTimeout(() => findChannel(), 5000);
      }
    });

    // PENTING: Semua event listener diletakkan DI DALAM try block
    sock.ev.on('creds.update', saveCreds);

    // Otomatis deteksi Saluran dari daftar chat
    sock.ev.on('chats.upsert', (chats) => {
      chats.forEach(chat => {
        if (chat.id.endsWith('@newsletter')) {
          if (!CHANNEL_JID) {
            CHANNEL_JID = chat.id;
            console.log(`[WA] 🎯 Saluran aktif diset otomatis.`);
          }
        }
      });
    });

    // Otomatis deteksi Saluran dari pesan yang masuk/dikirim
    sock.ev.on('messages.upsert', (m) => {
      const msg = m.messages[0];
      const jid = msg.key.remoteJid;
      if (jid && jid.endsWith('@newsletter')) {
        if (!CHANNEL_JID) {
          CHANNEL_JID = jid;
          console.log(`[WA] 🎯 Saluran aktif ditemukan via pesan.`);
        }
      }
    });

  } catch (initErr) {
    console.error('[WA] 🚨 Gagal Inisialisasi Fatal:', initErr);
  }
}

async function findChannel() {
  setTimeout(() => {
    if (!CHANNEL_JID) {
      console.log('[WA] ℹ️  Sedang menunggu sinkronisasi Saluran... Jika tidak muncul, pastikan Anda sudah memposting sesuatu di Saluran tersebut.');
    }
  }, 10000);
}

async function sendToChannel(menfessData) {
  if (!isConnected || !sock || !CHANNEL_JID) {
    console.log('[WA] ⚠️  Belum terkoneksi atau saluran belum ditemukan.');
    return false;
  }

  try {
    const message = formatMenfessMessage(menfessData);
    const result = await sock.sendMessage(CHANNEL_JID, { text: message });
    console.log(`[WA] 📨 Menfess ${menfessData.unique_id} terkirim ke saluran!`);
    return result.key.id;
  } catch (err) {
    console.error('[WA] Gagal kirim menfess:', err.message);
    return null;
  }
}

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
  } catch (err) {
    console.error('[WA] Gagal menghapus pesan:', err.message);
    return false;
  }
}

async function sendCommentToChannel(parentUniqueId, parentContent, commentData) {
  if (!isConnected || !sock || !CHANNEL_JID) return false;
  try {
    const shortParent = parentContent.length > 100 ? parentContent.substring(0, 100) + '...' : parentContent;
    const message = [
      `💬 *Balasan untuk Menfess #${parentUniqueId}:*`,
      `> "${shortParent}"`,
      '',
      commentData.content,
      '',
      '• - - - - - - - - - - - - - - -',
      `💬 Balas/Lihat di: ${BASE_URL}/#${parentUniqueId}`,
      '',
      `— ArchiFes Menfess`
    ].join('\n');
    await sock.sendMessage(CHANNEL_JID, { text: message });
    return true;
  } catch (err) {
    return false;
  }
}

function formatMenfessMessage(data) {
  return [
    data.content,
    '',
    '• - - - - - - - - - - - - - - -',
    '',
    `💌 ${data.unique_id} (${data.sender_name || 'Anonim'})`,
    `💬 Balas/Lihat di: ${BASE_URL}/#${data.unique_id}`,
    '',
    `— ArchiFes | Menfess Arsitektur Unnes`
  ].join('\n');
}

function setChannelJid(jid) { CHANNEL_JID = jid; }
function getStatus() { return { connected: isConnected, channelJid: CHANNEL_JID }; }

export { connectWhatsApp, sendToChannel, sendCommentToChannel, deleteFromChannel, setChannelJid, getStatus };
