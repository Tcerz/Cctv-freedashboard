require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const streamManager = require('./streamManager');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ---- Basic Auth sederhana (opsional, aktif jika ADMIN_USER di-set di .env) ----
app.use((req, res, next) => {
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;
  if (!adminUser || !adminPass) return next(); // auth dimatikan jika tidak dikonfigurasi

  const header = req.headers.authorization || '';
  const [, encoded] = header.split(' ');
  if (encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user === adminUser && pass === adminPass) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="CCTV Dashboard"');
  return res.status(401).send('Autentikasi diperlukan');
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/streams', express.static(path.join(__dirname, '..', 'streams')));

// ---------- GROUPS (folder depot) ----------
app.get('/api/groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM groups ORDER BY name ASC').all();
  const counts = db.prepare('SELECT group_id, COUNT(*) as n FROM cameras GROUP BY group_id').all();
  const countMap = Object.fromEntries(counts.map(c => [c.group_id, c.n]));
  res.json(groups.map(g => ({ ...g, camera_count: countMap[g.id] || 0 })));
});

app.post('/api/groups', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nama group wajib diisi' });
  const info = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name.trim());
  res.json({ id: info.lastInsertRowid, name });
});

app.put('/api/groups/:id', (req, res) => {
  const { name } = req.body;
  db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/groups/:id', (req, res) => {
  const cams = db.prepare('SELECT id FROM cameras WHERE group_id = ?').all(req.params.id);
  cams.forEach(c => streamManager.stopStream(c.id));
  db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- CAMERAS ----------
app.get('/api/cameras', (req, res) => {
  const { group_id } = req.query;
  const rows = group_id
    ? db.prepare('SELECT * FROM cameras WHERE group_id = ? ORDER BY name ASC').all(group_id)
    : db.prepare('SELECT * FROM cameras ORDER BY name ASC').all();
  // Jangan kirim password mentah ke frontend list biasa
  res.json(rows.map(({ password, ...rest }) => rest));
});

app.post('/api/cameras', (req, res) => {
  const { group_id, name, ip, port, username, password, rtsp_path, brand_label } = req.body;
  if (!group_id || !name || !ip || !username || !password) {
    return res.status(400).json({ error: 'Field wajib: group_id, name, ip, username, password' });
  }
  const info = db.prepare(`
    INSERT INTO cameras (group_id, name, ip, port, username, password, rtsp_path, brand_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(group_id, name, ip, port || 554, username, password, rtsp_path || '/Streaming/Channels/101', brand_label || 'Custom');
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/cameras/:id', (req, res) => {
  const { name, ip, port, username, password, rtsp_path, brand_label, group_id } = req.body;
  streamManager.stopStream(req.params.id); // paksa restart stream dengan config baru
  db.prepare(`
    UPDATE cameras SET name=?, ip=?, port=?, username=?, password=?, rtsp_path=?, brand_label=?, group_id=?
    WHERE id = ?
  `).run(name, ip, port, username, password, rtsp_path, brand_label, group_id, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/cameras/:id', (req, res) => {
  streamManager.stopStream(req.params.id);
  db.prepare('DELETE FROM cameras WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- STREAM CONTROL ----------
app.post('/api/cameras/:id/stream/start', (req, res) => {
  const camera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id);
  if (!camera) return res.status(404).json({ error: 'Kamera tidak ditemukan' });
  try {
    const result = streamManager.startStream(camera);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memulai stream', detail: String(err) });
  }
});

app.post('/api/cameras/:id/stream/touch', (req, res) => {
  streamManager.touchStream(req.params.id);
  res.json({ ok: true });
});

app.post('/api/cameras/:id/stream/stop', (req, res) => {
  const stopped = streamManager.stopStream(req.params.id);
  res.json({ ok: stopped });
});

app.listen(PORT, () => {
  console.log(`CCTV Dashboard jalan di http://localhost:${PORT}`);
});
