require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRoutes    = require('./routes/auth');
const sessionRoutes = require('./routes/session');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Middleware ── */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── Serve the portal HTML (put your frontend file here) ── */
app.use(express.static(path.join(__dirname, 'public')));

/* ── Routes ── */
app.use('/api/auth',    authRoutes);
app.use('/api/session', sessionRoutes);

/* ── Captive portal redirect ──────────────────────────────────────
   When a device connects to the hotspot and tries to reach any URL,
   dnsmasq redirects all DNS to this server's IP. This catch-all
   sends them to the portal page.
   (For HTTPS captive portals you'll also need a self-signed cert.)
───────────────────────────────────────────────────────────────── */
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
