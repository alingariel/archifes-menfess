import wwebjs from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, rmSync } from 'fs';

const { Client, LocalAuth } = wwebjs;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let client = null;
let isConnected = false;
let CHANNEL_JID = null;

const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3001';
const dataDir = path.resolve(__dirname, 'data');
const authPath = path.join(dataDir, '.wwebjs_auth');

if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

export async function connectWhatsApp() {
  console.log('\n[WA] 🚀 Inisialisasi Bot dengan Browser Asli...');
  
  if (process.env.RESET_WA_SESSION === 'true') {
    console.log('[WA] 🧹 Membersihkan sesi lama...');
    if (existsSync(authPath)) rmSync(authPath, { recursive: true, force: true });
    const qrFile = path.join(dataDir, 'whatsapp_qr.png');
    if (existsSync(qrFile)) rmSync(qrFile, { force: true });
  }

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: dataDir }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', 
        '--disable-gpu'
      ]
    }
  });

  client.on('qr', (qr) => {
    console.log('\n========================================');
    console.log('      📟 WHATSAPP PAIRING SESSION');
    console.log('========================================');
    qrcodeTerminal.generate(qr, { small: true });
    QRCode.toFile(path.join(dataDir, 'whatsapp_qr.png'), qr);
    console.log('\n  Scan QR di atas lewat aplikasi WhatsApp Anda.');
    console.log('  Atau lihat di web: /api/wa/qr\n');
  });

  client.on('ready', async () => {
    isConnected = true;
    console.log('\n[WA] ✅ BERHASIL TERHUBUNG KE WHATSAPP (Browser Asli)!');
    console.log('[WA] 🕵️‍♂️ Memulai deteksi Saluran otomatis...');
    
    // Auto detect channel
    try {
      const chats = await client.getChats();
      for (const chat of chats) {
        if (chat.isGroup === false && chat.id._serialized.includes('newsletter')) {
          if (!CHANNEL_JID) {
            CHANNEL_JID = chat.id._serialized;
            console.log(`\n[WA] 🎯 SALURAN TERDETEKSI: ${chat.name || chat.id._serialized}\n`);
          }
        }
      }
    } catch(e) {
      console.log('[WA] Gagal mengambil daftar channel:', e.message);
    }
  });

  client.on('message_create', (msg) => {
    if (msg.to.includes('newsletter') && !CHANNEL_JID) {
       CHANNEL_JID = msg.to;
       console.log(`\n[WA] 🎯 SALURAN TERDETEKSI VIA PESAN: ${CHANNEL_JID}\n`);
    }
  });

  client.on('disconnected', (reason) => {
    console.log('[WA] ⚠️ Koneksi Terputus:', reason);
    isConnected = false;
    setTimeout(() => {
        client.initialize();
    }, 5000);
  });

  client.initialize().catch(err => {
    console.error('[WA] 🚨 Gagal Inisialisasi Puppeteer:', err.message);
  });
}

function formatMessage(data, comments = []) {
  let msg = [
    data.content,
    '',
    '• - - - - - - - - - - - - - - -',
    `💌 ${data.unique_id} (${data.sender_name || 'Anonim'})`,
    `💬 Balas/Lihat di: ${BASE_URL}/#${data.unique_id}`
  ].join('\n');

  if (comments && comments.length > 0) {
    msg += '\n\n• - - Komentar - - -\n';
    comments.forEach((c, i) => {
      msg += `${i+1}. ${c.content}\n`;
    });
  }
  return msg;
}

export async function sendToChannel(data) {
  if (!isConnected || !client || !CHANNEL_JID) return null;
  try {
    const text = formatMessage(data);
    const sentMsg = await client.sendMessage(CHANNEL_JID, text);
    console.log(`[WA] 📨 Menfess ${data.unique_id} terkirim!`);
    return sentMsg.id._serialized;
  } catch (err) {
    console.error('[WA] Gagal kirim ke saluran:', err.message);
    return null;
  }
}

export async function sendCommentToChannel(parentUniqueId, parentContent, commentData) {
  if (!isConnected || !client || !CHANNEL_JID) return false;
  // Fallback if editing is tricky: send as a quote reply or just new message
  try {
     const shortParent = parentContent.length > 50 ? parentContent.substring(0, 50) + '...' : parentContent;
     const text = `💬 *Komentar Baru #${parentUniqueId}:*\n> "${shortParent}"\n\n${commentData.content}`;
     await client.sendMessage(CHANNEL_JID, text);
     return true;
  } catch(e) {
      return false;
  }
}

export async function deleteFromChannel(messageId) {
  return false; // wwebjs delete might require full msg object, we keep it safe for now.
}

export function getStatus() { return { connected: isConnected, channelJid: CHANNEL_JID }; }
export function setChannelJid(jid) { }
