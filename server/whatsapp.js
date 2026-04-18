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

const logger = pino({ level: 'silent' });

let sock = null;
let isConnected = false;
let CHANNEL_JID = '120363428902488979@newsletter';
let pairingRequested = false;

const PHONE_NUMBER = process.env.WA_PHONE_NUMBER || '628123456789'; // Masukkan nomor HP Anda di Variables Railway
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3001';

async function connectWhatsApp() {
  // Import dinamis untuk mengatasi masalah kompatibilitas ESM
  const { 
    default: makeWASocket,
    useMultiFileAuthState, 
    DisconnectReason, 
    makeCacheableSignalKeyStore, 
    fetchLatestBaileysVersion 
  } = await import('@whiskeysockets/baileys');

  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'data', 'wa_auth'));
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    browser: ['Windows', 'Chrome', '11.0.0'],
    markOnline: true,
    connectTimeoutMs: 60000,
    retryRequestDelayMs: 2000,
    defaultQueryTimeoutMs: undefined,
    syncFullHistory: false,
  });

  // Event: Connection Update
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Tampilkan QR jika muncul DAN belum pernah request pairing
    if (qr && !pairingRequested && !sock.authState.creds.registered) {
      pairingRequested = true;
      
      console.log('\n========================================');
      console.log('  WHATSAPP PAIRING - SCAN QR CODE');
      console.log('========================================\n');
      qrcodeTerminal.generate(qr, { small: true });
      
      // Save QR to file for easier scanning
      QRCode.toFile(path.join(__dirname, 'data', 'whatsapp_qr.png'), qr, (err) => {
        if (err) console.error('[WA] Gagal simpan file QR:', err);
        else console.log('[WA] 🖼️  QR Code disimpan ke: data/whatsapp_qr.png (Silakan buka file ini untuk scan)');
      });
      console.log('\n  Scan QR di atas dari WhatsApp > Perangkat Tertaut > Tautkan Perangkat');
      console.log('  ATAU gunakan pairing code di bawah:\n');
      
      try {
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log(`  📱 KODE PASANGAN: ${code}`);
        console.log('  (Buka WA > Perangkat Tertaut > Tautkan dengan nomor telepon)\n');
        console.log('========================================\n');
      } catch (err) {
        console.log('  ⚠️  Pairing code gagal, gunakan QR code di atas.\n');
        console.log('========================================\n');
      }
      // QR berikutnya (refresh)
      console.log('\n[WA] 🔄 QR Code diperbarui, scan ulang:');
      qrcodeTerminal.generate(qr, { small: true });
      
      QRCode.toFile(path.join(__dirname, 'data', 'whatsapp_qr.png'), qr, (err) => {
        if (err) console.error('[WA] Gagal update file QR:', err);
      });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[WA] Koneksi terputus (status: ${statusCode}). Reconnect: ${shouldReconnect}`);
      isConnected = false;
      if (shouldReconnect) {
        setTimeout(() => connectWhatsApp(), 5000);
      } else {
        console.log('[WA] ❌ Logged out. Hapus folder wa_auth lalu restart.');
      }
    } else if (connection === 'open') {
      isConnected = true;
      pairingRequested = false;
      console.log('[WA] ✅ Berhasil terhubung ke WhatsApp!');
      
      // DEBUG: Lihat method apa saja yang tersedia
      console.log('[WA] DEBUG - Available newsletter methods:', 
        Object.keys(sock).filter(k => k.toLowerCase().includes('newsletter') || k.toLowerCase().includes('joined'))
      );
      
      setTimeout(() => findChannel(), 5000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Otomatis deteksi Saluran dari daftar chat
  sock.ev.on('chats.upsert', (chats) => {
    chats.forEach(chat => {
      if (chat.id.endsWith('@newsletter')) {
        console.log(`[WA] 📢 Saluran ditemukan via Chat: ${chat.name || 'Tanpa Nama'} (${chat.id})`);
        if (!CHANNEL_JID) {
          CHANNEL_JID = chat.id;
          console.log(`[WA] 🎯 Saluran aktif diset otomatis ke: ${chat.id}`);
        }
      }
    });
  });

  // Otomatis deteksi Saluran dari pesan yang masuk/dikirim
  sock.ev.on('messages.upsert', (m) => {
    const msg = m.messages[0];
    const jid = msg.key.remoteJid;
    if (jid && jid.endsWith('@newsletter')) {
      console.log(`[WA] 📢 Saluran ditemukan via Pesan: (${jid})`);
      if (!CHANNEL_JID) {
        CHANNEL_JID = jid;
        console.log(`[WA] 🎯 Saluran aktif diset otomatis ke: ${jid}`);
      }
    }
  });
}

async function findChannel() {
  // Fungsi ini sekarang hanya pengingat jika belum ada saluran yang terdeteksi
  setTimeout(() => {
    if (!CHANNEL_JID) {
      console.log('[WA] ℹ️  Sedang menunggu sinkronisasi Saluran... Jika tidak muncul, pastikan Anda sudah memposting sesuatu di Saluran tersebut atau set JID manual.');
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
    
    // Kembalikan ID pesan agar bisa disimpan di DB
    return result.key.id;
  } catch (err) {
    console.error('[WA] Gagal kirim menfess:', err.message);
    return null;
  }
}

// Menghapus pesan dari saluran
async function deleteFromChannel(messageId) {
  if (!isConnected || !sock || !CHANNEL_JID || !messageId) {
    console.log('[WA] ⚠️ Batal hapus: Data tidak lengkap atau belum terkoneksi.');
    return false;
  }

  try {
    await sock.sendMessage(CHANNEL_JID, { 
      delete: { 
        remoteJid: CHANNEL_JID, 
        fromMe: true, 
        id: messageId,
        participant: sock.user.id.split(':')[0] + '@s.whatsapp.net' // Penting untuk newsletter
      } 
    });
    console.log(`[WA] 🗑️  Pesan ID ${messageId} berhasil dihapus dari saluran.`);
    return true;
  } catch (err) {
    console.error('[WA] Gagal menghapus pesan:', err.message);
    return false;
  }
}

// Kirim balasan/komentar ke saluran
async function sendCommentToChannel(parentUniqueId, parentContent, commentData) {
  if (!isConnected || !sock || !CHANNEL_JID) return false;

  try {
    // Potong pesan asli jika terlalu panjang
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
    console.log(`[WA] 📨 Balasan untuk #${parentUniqueId} terkirim!`);
    return true;
  } catch (err) {
    console.error('[WA] Gagal kirim balasan:', err.message);
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
