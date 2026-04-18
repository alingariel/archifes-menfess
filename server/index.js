import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Filter from 'bad-words';
import path from 'path';
import { fileURLToPath } from 'url';

const sqlite3verbose = sqlite3.verbose();

// Simulasi __dirname di ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Khusus custom bad-words in indonesian jika diperlukan
const filter = new Filter();
filter.addWords('bodoh', 'tolol', 'goblok', 'bangsat', 'anjing', 'babi', 'kontol', 'memek', 'ngentot', 'bajingan');

// WhatsApp Channel Integration
import { connectWhatsApp, sendToChannel, sendCommentToChannel, deleteFromChannel, getStatus } from './whatsapp.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Untuk development, buka ke semua. Di production spesifik
  }
});

// Database
const db = new sqlite3verbose.Database(path.join(__dirname, 'server', 'data', 'archifes.db'), (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    // Create tables
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS menfess (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        unique_id TEXT UNIQUE,
        content TEXT,
        sender_name TEXT,
        theme_color TEXT,
        ip_address TEXT,
        session_id TEXT,
        wa_message_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        menfess_id INTEGER,
        content TEXT,
        session_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(menfess_id) REFERENCES menfess(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        menfess_id INTEGER,
        count INTEGER DEFAULT 0,
        FOREIGN KEY(menfess_id) REFERENCES menfess(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS contact_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        message TEXT,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
    });
  }
});

// Middlewares
app.use(cors());
app.use(express.json());

// Trust proxy for rate limiting (if behind a proxy like Nginx, but good practice here)
app.set('trust proxy', 1);

const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 menit
  max: 3, // batas 3 kali posting per IP dalam waktu 5 menit
  message: { error: 'Terlalu banyak permintaan dari IP ini, silakan coba lagi setelah 5 menit.' }
});

// Generator soal matematika sederhana untuk Captcha
app.get('/api/captcha', (req, res) => {
  const num1 = Math.floor(Math.random() * 10) + 1;
  const num2 = Math.floor(Math.random() * 10) + 1;
  const operator = '+';
  const result = num1 + num2;
  
  const token = Buffer.from(result.toString()).toString('base64');
  
  res.json({
    question: `Berapa hasil dari ${num1} ${operator} ${num2}?`,
    token: token
  });
});

// Endpoints
app.get('/api/menfess', (req, res) => {
  const query = `
    SELECT m.*, l.count as likes
    FROM menfess m
    LEFT JOIN likes l ON m.id = l.menfess_id
    ORDER BY m.created_at DESC
    LIMIT 50
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal mengambil data menfess.' });
    }

    // Ambil komentar untuk setiap menfess
    const menfessIds = rows.map(r => r.id);
    if (menfessIds.length === 0) return res.json([]);

    db.all(`SELECT * FROM comments WHERE menfess_id IN (${menfessIds.join(',')})`, [], (err2, comments) => {
      const result = rows.map(row => ({
        ...row,
        comments: (comments || []).filter(c => c.menfess_id === row.id)
      }));
      res.json(result);
    });
  });
});

app.post('/api/menfess', apiLimiter, (req, res) => {
  const { content, sender_name, theme_color, captcha_answer, captcha_token } = req.body;
  
  // Validasi Captcha sederhana
  if (!captcha_answer || !captcha_token) {
    return res.status(400).json({ error: 'Selesaikan captcha terlebih dahulu.' });
  }
  const expectedResult = Buffer.from(captcha_token, 'base64').toString();
  if (captcha_answer !== expectedResult) {
    return res.status(400).json({ error: 'Jawaban captcha salah.' });
  }

  if (!content || content.length < 5) {
    return res.status(400).json({ error: 'Konten terlalu pendek (min 5 karakter).' });
  }

  const cleanContent = filter.clean(content);
  const uniqueId = '#ARC-' + Math.floor(1000 + Math.random() * 9000);
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const sessionId = req.headers['x-session-id'] || 'anon';

  const stmt = db.prepare('INSERT INTO menfess (unique_id, content, sender_name, theme_color, ip_address, session_id) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run([uniqueId, cleanContent, sender_name || 'Anonim', theme_color || '#1a1a1a', ip, sessionId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Gagal mengirim menfess.' });
    }
    
    const baru = {
      id: this.lastID,
      unique_id: uniqueId,
      content: cleanContent,
      sender_name: sender_name || 'Anonim',
      theme_color: theme_color || '#1a1a1a',
      likes: 0,
      comments: [],
      created_at: new Date().toISOString()
    };

    io.emit('new_menfess', baru);

    // Kirim ke Saluran WhatsApp & Simpan ID pesannya
    sendToChannel(baru).then(waId => {
      if (waId) {
        db.run('UPDATE menfess SET wa_message_id = ? WHERE id = ?', [waId, baru.id]);
        console.log(`[WA] ID Pesan ${waId} tersimpan untuk menfess ${baru.unique_id}`);
      }
    }).catch(err => console.error('[WA] Error:', err.message));

    res.status(201).json(baru);
  });
});

app.post('/api/menfess/:id/like', (req, res) => {
  const menfessId = req.params.id;
  
  db.run(`INSERT INTO likes (menfess_id, count) VALUES (?, 1) ON CONFLICT(menfess_id) DO UPDATE SET count = count + 1`, [menfessId], function(err) {
    if (err) return res.status(500).json({ error: 'Gagal menyukai.' });
    
    db.get('SELECT count FROM likes WHERE menfess_id = ?', [menfessId], (err2, row) => {
      io.emit('update_like', { menfess_id: menfessId, count: row.count });
      res.json({ success: true, count: row.count });
    });
  });
});

app.post('/api/menfess/:id/comments', (req, res) => {
  const menfessId = req.params.id;
  const { content } = req.body;
  const sessionId = req.headers['x-session-id'] || 'anon';

  if (!content) return res.status(400).json({ error: 'Komentar kosong.' });

  const cleanContent = filter.clean(content);
  db.run('INSERT INTO comments (menfess_id, content, session_id) VALUES (?, ?, ?)', [menfessId, cleanContent, sessionId], function(err) {
    if (err) return res.status(500).json({ error: 'Gagal mengirim komentar.' });
    
    const newComment = {
      id: this.lastID,
      menfess_id: menfessId,
      content: cleanContent,
      created_at: new Date().toISOString()
    };
    
    io.emit('new_comment', newComment);

    // Integrasi ke WhatsApp Saluran
    db.get('SELECT unique_id, content FROM menfess WHERE id = ?', [menfessId], (err, row) => {
      if (row) {
        sendCommentToChannel(row.unique_id, row.content, newComment);
      }
    });

    res.status(201).json(newComment);
  });
});

app.delete('/api/menfess/:id', (req, res) => {
  const menfessId = req.params.id;
  const authMsg = req.headers['authorization'];
  
  if (authMsg !== 'admin123') {
    return res.status(401).json({ error: 'Otorisasi ditolak!' });
  }

  // Cari wa_message_id sebelum dihapus dari DB
  db.get('SELECT wa_message_id FROM menfess WHERE id = ?', [menfessId], (err, row) => {
    if (row && row.wa_message_id) {
      deleteFromChannel(row.wa_message_id).catch(err => console.error('[WA] Gagal hapus pesan di WA:', err.message));
    }

    db.run('DELETE FROM comments WHERE menfess_id = ?', [menfessId], (err) => {
      if (err) console.error("Gagal hapus komentar", err);
      db.run('DELETE FROM likes WHERE menfess_id = ?', [menfessId], (err2) => {
        if (err2) console.error("Gagal hapus likes", err2);
        db.run('DELETE FROM menfess WHERE id = ?', [menfessId], function(err3) {
          if (err3) {
            return res.status(500).json({ error: 'Gagal menghapus pesan utama.' });
          }
          if (this.changes === 0) {
             return res.status(404).json({ error: 'Pesan tidak ditemukan.' });
          }
          io.emit('delete_menfess', parseInt(menfessId));
          res.json({ success: true, message: 'Menfess dihapus' });
        });
      });
    });
  });
});

// Kontak
app.post('/api/contact', (req, res) => {
  const { email, message } = req.body;
  if (!email || !message) return res.status(400).json({ error: 'Data tidak lengkap.' });

  db.run('INSERT INTO contact_messages (email, message) VALUES (?, ?)', [email, message], function(err) {
    if (err) return res.status(500).json({ error: 'Gagal kirim pesan.' });
    res.json({ success: true });
  });
});

app.get('/api/contact', (req, res) => {
  const authMsg = req.headers['authorization'];
  if (authMsg !== 'admin123') {
    return res.status(401).json({ error: 'Otorisasi ditolak!' });
  }
  db.all('SELECT * FROM contact_messages ORDER BY created_at DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal mengambil pesan.' });
    }
    res.json(rows || []);
  });
});

io.on('connection', (socket) => {
  console.log('Klien terhubung:', socket.id);
  socket.on('disconnect', () => {
    console.log('Klien terputus:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
  
  // Mulai koneksi WhatsApp
  connectWhatsApp().catch(err => console.error('[WA] Gagal memulai:', err.message));
});
