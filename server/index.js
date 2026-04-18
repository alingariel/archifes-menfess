const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Filter = require('bad-words');

// Khusus custom bad-words in indonesian jika diperlukan
const filter = new Filter();
filter.addWords('bodoh', 'tolol', 'goblok', 'bangsat', 'anjing', 'babi', 'kontol', 'memek', 'ngentot', 'bajingan');

// WhatsApp Channel Integration
const { connectWhatsApp, sendToChannel, sendCommentToChannel, deleteFromChannel, getStatus } = require('./whatsapp');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Untuk development, buka ke semua. Di production spesifik
  }
});

// Database
const db = new sqlite3.Database('./archifes.db', (err) => {
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
  
  // Dalam best practice, hasil ini harus disimpan di sesi server lalu divalidasi.
  // Untuk kesederhanaan stateless API di level ini, kita bisa mengirim jawaban di-hash atau menyimpannya di memory (token).
  // Di sini kita gunakan JWT ringan atau menyandikan nilai as expectedValue
  const token = Buffer.from(result.toString()).toString('base64');
  
  res.json({
    question: `Berapa hasil dari ${num1} ${operator} ${num2}?`,
    token: token
  });
});

app.post('/api/menfess', apiLimiter, (req, res) => {
  const { content, sender_name, theme_color, session_id } = req.body;
  
  // Validasi Konten
  if (!content || content.length > 280) {
    return res.status(400).json({ error: 'Konten tidak valid atau melebihi 280 karakter.' });
  }

  // Filter bad words
  const cleanContent = filter.clean(content);
  const cleanSender = sender_name ? filter.clean(sender_name) : 'Anonim';
  const finalTheme = theme_color || '#1a1a1a'; // Default theme
  
  // Generate Unique ID
  const uniqueId = '#ARC-' + Math.floor(1000 + Math.random() * 9000);
  const ipAddress = req.ip || req.connection.remoteAddress;

  const stmt = db.prepare('INSERT INTO menfess (unique_id, content, sender_name, theme_color, ip_address, session_id) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run([uniqueId, cleanContent, cleanSender, finalTheme, ipAddress, session_id], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Gagal menyimpan menfess.' });
    }
    
    // Inisialisasi data di tabel Likes
    db.run('INSERT INTO likes (menfess_id) VALUES (?)', [this.lastID]);

    const baru = {
      id: this.lastID,
      unique_id: uniqueId,
      content: cleanContent,
      sender_name: cleanSender,
      theme_color: finalTheme,
      created_at: new Date().toISOString(),
      likes: 0,
      comments: []
    };

    // Broadcast pesan baru
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
      return res.status(500).json({ error: 'Gagal mengambil menfess.' });
    }
    
    // Ambil semua comments untuk menfess tersebut
    const menfessIds = rows.map(r => r.id);
    if (menfessIds.length === 0) {
      return res.json([]);
    }

    const placeholders = menfessIds.map(() => '?').join(',');
    db.all(`SELECT * FROM comments WHERE menfess_id IN (${placeholders}) ORDER BY created_at ASC`, menfessIds, (err2, commentsRows) => {
      if (err2) {
        return res.status(500).json({ error: 'Gagal mengambil komentar.' });
      }

      // Gabungkan comments ke masing2 menfess
      const populated = rows.map(menfess => {
        menfess.comments = commentsRows.filter(c => c.menfess_id === menfess.id);
        return menfess;
      });

      res.json(populated);
    });
  });
});

app.post('/api/menfess/:id/like', (req, res) => {
  const menfessId = req.params.id;
  db.run('UPDATE likes SET count = count + 1 WHERE menfess_id = ?', [menfessId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Gagal like menfess.' });
    }
    
    db.get('SELECT count FROM likes WHERE menfess_id = ?', [menfessId], (err2, row) => {
      if (row) {
        io.emit('update_like', { menfess_id: menfessId, count: row.count });
        res.json({ count: row.count });
      }
    });
  });
});

app.post('/api/menfess/:id/unlike', (req, res) => {
  const menfessId = req.params.id;
  db.run('UPDATE likes SET count = count - 1 WHERE menfess_id = ? AND count > 0', [menfessId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Gagal unlike menfess.' });
    }
    
    db.get('SELECT count FROM likes WHERE menfess_id = ?', [menfessId], (err2, row) => {
      if (row) {
        io.emit('update_like', { menfess_id: menfessId, count: row.count });
        res.json({ count: row.count });
      } else {
        res.status(404).json({ error: 'Not found' });
      }
    });
  });
});

app.post('/api/menfess/:id/comments', (req, res) => {
  const menfessId = req.params.id;
  const { content, session_id } = req.body;
  if (!content) return res.status(400).json({ error: 'Komentar tidak boleh kosong' });

  const cleanContent = filter.clean(content);

  db.run('INSERT INTO comments (menfess_id, content, session_id) VALUES (?, ?, ?)', [menfessId, cleanContent, session_id], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Gagal membalas.' });
    }
    const comment = { id: this.lastID, menfess_id: parseInt(menfessId), content: cleanContent, session_id: session_id, created_at: new Date().toISOString() };
    io.emit('new_comment', comment);

    // Kirim notifikasi balasan ke WhatsApp
    db.get('SELECT unique_id, content FROM menfess WHERE id = ?', [menfessId], (err, row) => {
      if (row) {
        sendCommentToChannel(row.unique_id, row.content, comment).catch(err => console.error('[WA] Error Comments:', err.message));
      }
    });

    res.status(201).json(comment);
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

// ========== CONTACT ADMIN ==========
app.post('/api/contact', (req, res) => {
  const { email, message } = req.body;
  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
  }
  const cleanEmail = email ? email.trim() : 'anonim@archifes.id';
  const cleanMessage = filter.clean(message.trim());

  db.run('INSERT INTO contact_messages (email, message) VALUES (?, ?)', [cleanEmail, cleanMessage], function(err) {
    if (err) {
      console.error('Gagal menyimpan pesan kontak:', err);
      return res.status(500).json({ error: 'Gagal mengirim pesan.' });
    }
    res.status(201).json({ success: true, message: 'Pesan berhasil dikirim ke admin.' });
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
