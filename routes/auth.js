const express        = require('express');
const bcrypt         = require('bcryptjs');
const jwt            = require('jsonwebtoken');
const { userHelpers } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/* ───────────────────────────────────────────────
   Input validation helpers
─────────────────────────────────────────────── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validRegister({ name, email, phone, password }) {
  if (!name || !email || !phone || !password) return 'All fields are required.';
  if (typeof name !== 'string' || name.length > 80)  return 'Invalid name.';
  if (typeof email !== 'string' || email.length > 120 || !EMAIL_RE.test(email)) return 'Invalid email address.';
  if (typeof phone !== 'string' || phone.length > 20) return 'Invalid phone number.';
  if (typeof password !== 'string' || password.length < 6 || password.length > 200) return 'Password must be 6–200 characters.';
  return null;
}

/* ────────────────────────────────────────────
   POST /api/auth/register
──────────────────────────────────────────── */
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body || {};

    const error = validRegister({ name, email, phone, password });
    if (error) return res.status(400).json({ success: false, message: error });

    const cleanEmail = email.trim().toLowerCase();

    const existing = userHelpers.findByEmail.get(cleanEmail);
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const result = userHelpers.create.run({
      name: name.trim(),
      email: cleanEmail,
      phone: phone.trim(),
      password_hash,
    });
    const user = userHelpers.findById.get(result.lastInsertRowid);

    const token = issueToken(user);
    return res.status(201).json({ success: true, token, user: publicUser(user) });

  } catch (err) {
    console.error('[auth/register]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* ────────────────────────────────────────────
   POST /api/auth/login
──────────────────────────────────────────── */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password ||
        typeof email !== 'string' || typeof password !== 'string' ||
        email.length > 120 || password.length > 200) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = userHelpers.findByEmail.get(email.trim().toLowerCase());
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
    console.error('[auth/login]', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* ────────────────────────────────────────────
   POST /api/auth/logout
──────────────────────────────────────────── */
router.post('/logout', requireAuth, (req, res) => {
  return res.json({ success: true });
});

/* ────────────────────────────────────────────
   GET /api/auth/me
──────────────────────────────────────────── */
router.get('/me', requireAuth, (req, res) => {
  return res.json({ success: true, user: req.user });
});

/* ── helpers ── */
function issueToken(user) {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone };
}

module.exports = router;
