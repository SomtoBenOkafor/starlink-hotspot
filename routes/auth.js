const express        = require('express');
const bcrypt         = require('bcryptjs');
const jwt            = require('jsonwebtoken');
const { userHelpers } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/* ────────────────────────────────────────────
   POST /api/auth/register
   Body: { name, email, phone, password }
──────────────────────────────────────────── */
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    /* Validation */
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    /* Check duplicate */
    const existing = userHelpers.findByEmail.get(email);
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    /* Hash password — bcrypt with cost factor 12 */
    const password_hash = await bcrypt.hash(password, 12);

    /* Insert */
    const result = userHelpers.create.run({ name, email: email.toLowerCase(), phone, password_hash });
    const user   = userHelpers.findById.get(result.lastInsertRowid);

    /* Issue JWT */
    const token = issueToken(user);
    return res.status(201).json({ success: true, token, user: publicUser(user) });

  } catch (err) {
    console.error('[auth/register]', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* ────────────────────────────────────────────
   POST /api/auth/login
   Body: { email, password }
──────────────────────────────────────────── */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = userHelpers.findByEmail.get(email);
    if (!user) {
      /* Generic message — don't reveal whether email exists */
      return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
    }

    const token = issueToken(user);
    return res.json({ success: true, token, user: publicUser(user) });

  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* ────────────────────────────────────────────
   POST /api/auth/logout   (requires auth)
   Client should also discard the token locally.
──────────────────────────────────────────── */
router.post('/logout', requireAuth, (req, res) => {
  /* Stateless JWT — nothing to invalidate server-side.
     For stricter logout, maintain a token blocklist in Redis. */
  return res.json({ success: true });
});

/* ────────────────────────────────────────────
   GET /api/auth/me   (requires auth)
──────────────────────────────────────────── */
router.get('/me', requireAuth, (req, res) => {
  return res.json({ success: true, user: req.user });
});

/* ── helpers ── */
function issueToken(user) {
  return jwt.sign(
    { id: user.id },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }   /* token lasts 30 days */
  );
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone };
}

module.exports = router;
