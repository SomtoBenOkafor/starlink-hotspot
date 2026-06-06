require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRoutes    = require('./routes/auth');
const sessionRoutes = require('./routes/session');
const adminRoutes   = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── Health check — used by frontend signal indicator ── */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

/* ── API Routes ── */
app.use('/api/auth',    authRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/admin',   adminRoutes);

/* ── Serve portal frontend ── */
app.use(express.static(path.join(__dirname, 'public')));

/* ── Captive portal catch-all redirect ── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ── Global error handler ── */
app.use((err, req, res, next) => {
  console.error('[server error]', err);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────────────────┐
  │  Starlink Hotspot Backend               │
  │  Listening on http://0.0.0.0:${PORT}        │
  │  Environment: ${process.env.NODE_ENV || 'development'}              │
  └─────────────────────────────────────────┘
  `);
});
