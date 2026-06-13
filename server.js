require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const path        = require('path');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');

const authRoutes    = require('./routes/auth');
const sessionRoutes = require('./routes/session');
const adminRoutes   = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ───────────────────────────────────────────────
   SECURITY: trust proxy (needed for rate limiting
   to see real client IPs behind Railway/Vercel)
─────────────────────────────────────────────── */
app.set('trust proxy', 1);

/* ───────────────────────────────────────────────
   SECURITY: Helmet sets safe HTTP headers
   (clickjacking, MIME-sniffing protection, etc.)
─────────────────────────────────────────────── */
app.use(helmet({
  contentSecurityPolicy: false, // portal uses inline styles/scripts; keep off for now
}));

/* ───────────────────────────────────────────────
   SECURITY: Locked-down CORS
   Only allow your own frontend domains to call the API.
   Add/remove domains in ALLOWED_ORIGINS below.
─────────────────────────────────────────────── */
const ALLOWED_ORIGINS = [
  'https://starlink-hotspot-alpha.vercel.app',
  'https://starlink-hotspot-production.up.railway.app',
];
/* Allow extra origins from env (comma-separated) if you add a custom domain */
if (process.env.EXTRA_ORIGINS) {
  ALLOWED_ORIGINS.push(...process.env.EXTRA_ORIGINS.split(',').map(s => s.trim()));
}

app.use(cors({
  origin: function (origin, callback) {
    /* Allow requests with no origin (same-origin, curl, mobile apps, captive portal) */
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

/* ───────────────────────────────────────────────
   SECURITY: Body size limit (block giant payloads)
─────────────────────────────────────────────── */
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

/* ───────────────────────────────────────────────
   SECURITY: Rate limiters
─────────────────────────────────────────────── */

/* General limiter — applies to all API routes.
   300 requests per 15 min per IP. */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});

/* Strict limiter — for login/register/admin.
   10 attempts per 15 min per IP. Stops brute-force. */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Try again in 15 minutes.' },
});

/* Very strict limiter — for admin login specifically.
   5 attempts per 15 min per IP. */
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many admin login attempts. Try again later.' },
});

/* Apply general limit to everything under /api */
app.use('/api', generalLimiter);

/* ── Health check ── */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

/* ───────────────────────────────────────────────
   API Routes — with targeted rate limits
─────────────────────────────────────────────── */
/* Strict limit on auth login/register specifically */
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/admin/login',   adminLoginLimiter);

app.use('/api/auth',    authRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/admin',   adminRoutes);

/* ── Serve portal frontend (files live in repo root) ── */
app.use(express.static(path.join(__dirname)));

/* ── Captive portal catch-all redirect ── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ── Global error handler ── */
app.use((err, req, res, next) => {
  /* CORS errors get a clean 403 instead of a stack trace */
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'Origin not allowed.' });
  }
  console.error('[server error]', err);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`Starlink Hotspot Backend listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
