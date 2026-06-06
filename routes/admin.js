const express   = require('express');
const jwt       = require('jsonwebtoken');
const { db }    = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');
const { revokeAccess } = require('../network');

const router = express.Router();

/* ─────────────────────────────────────────────────────────────────
   POST /api/admin/login
   Body: { password }

   Uses ADMIN_PASSWORD from .env — completely separate from user
   accounts. Returns a short-lived JWT with role:'admin'.
───────────────────────────────────────────────────────────────── */
router.post('/login', (req, res) => {
  const { password } = req.body;

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ success: false, message: 'Admin access not configured.' });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Incorrect admin password.' });
  }

  const token = jwt.sign(
    { role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  return res.json({ success: true, token });
});

/* ─────────────────────────────────────────────────────────────────
   GET /api/admin/stats
   Returns revenue totals and high-level counts.

   DB queries against: sessions (amount_naira, paystack_ref,
   created_at), users (id, created_at)
───────────────────────────────────────────────────────────────── */
router.get('/stats', requireAdmin, (req, res) => {
  const revenueToday = db.prepare(`
    SELECT
      COUNT(*)                              AS count,
      COALESCE(SUM(amount_naira), 0)        AS total
    FROM sessions
    WHERE paystack_ref IS NOT NULL
      AND amount_naira > 0
      AND date(created_at, 'unixepoch') = date('now')
  `).get();

  const revenueWeek = db.prepare(`
    SELECT
      COUNT(*)                              AS count,
      COALESCE(SUM(amount_naira), 0)        AS total
    FROM sessions
    WHERE paystack_ref IS NOT NULL
      AND amount_naira > 0
      AND created_at >= strftime('%s','now','-7 days')
  `).get();

  const revenueAllTime = db.prepare(`
    SELECT
      COUNT(*)                              AS count,
      COALESCE(SUM(amount_naira), 0)        AS total
    FROM sessions
    WHERE paystack_ref IS NOT NULL
      AND amount_naira > 0
  `).get();

  const totalUsers = db.prepare(`
    SELECT COUNT(*) AS count FROM users
  `).get();

  const activeNow = db.prepare(`
    SELECT COUNT(*) AS count FROM sessions
    WHERE is_active = 1 AND seconds_remaining > 0
  `).get();

  const newUsersToday = db.prepare(`
    SELECT COUNT(*) AS count FROM users
    WHERE date(created_at, 'unixepoch') = date('now')
  `).get();

  return res.json({
    success: true,
    stats: {
      revenue: {
        today:    { naira: revenueToday.total,    count: revenueToday.count },
        week:     { naira: revenueWeek.total,     count: revenueWeek.count },
        allTime:  { naira: revenueAllTime.total,  count: revenueAllTime.count },
      },
      users: {
        total:    totalUsers.count,
        newToday: newUsersToday.count,
      },
      activeSessions: activeNow.count,
    }
  });
});

/* ─────────────────────────────────────────────────────────────────
   GET /api/admin/sessions/active
   Returns all currently active sessions with user details.
───────────────────────────────────────────────────────────────── */
router.get('/sessions/active', requireAdmin, (req, res) => {
  const sessions = db.prepare(`
    SELECT
      s.id,
      s.plan_label,
      s.seconds_total,
      s.seconds_remaining,
      s.user_ip,
      s.created_at,
      s.updated_at,
      u.id        AS user_id,
      u.name      AS user_name,
      u.email     AS user_email,
      u.phone     AS user_phone
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.is_active = 1
      AND s.seconds_remaining > 0
    ORDER BY s.updated_at DESC
  `).all();

  return res.json({ success: true, sessions });
});

/* ─────────────────────────────────────────────────────────────────
   GET /api/admin/sessions/recent?limit=50
   Returns the most recent sessions (active + paused + ended).
───────────────────────────────────────────────────────────────── */
router.get('/sessions/recent', requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  const sessions = db.prepare(`
    SELECT
      s.id,
      s.plan_label,
      s.seconds_total,
      s.seconds_remaining,
      s.is_active,
      s.amount_naira,
      s.paystack_ref,
      s.user_ip,
      s.created_at,
      s.updated_at,
      u.name  AS user_name,
      u.email AS user_email
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    ORDER BY s.created_at DESC
    LIMIT ?
  `).all(limit);

  return res.json({ success: true, sessions });
});

/* ─────────────────────────────────────────────────────────────────
   GET /api/admin/users?search=&limit=100
   Returns all users with aggregate session stats.
───────────────────────────────────────────────────────────────── */
router.get('/users', requireAdmin, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
  const search = req.query.search ? `%${req.query.search}%` : null;

  const query = search
    ? `
      SELECT
        u.id, u.name, u.email, u.phone, u.created_at,
        COUNT(s.id)                          AS session_count,
        COALESCE(SUM(s.amount_naira), 0)     AS total_spent,
        MAX(s.created_at)                    AS last_session_at,
        SUM(CASE WHEN s.is_active = 1 AND s.seconds_remaining > 0
                 THEN 1 ELSE 0 END)          AS is_currently_active
      FROM users u
      LEFT JOIN sessions s ON s.user_id = u.id
      WHERE u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ?
    `
    : `
      SELECT
        u.id, u.name, u.email, u.phone, u.created_at,
        COUNT(s.id)                          AS session_count,
        COALESCE(SUM(s.amount_naira), 0)     AS total_spent,
        MAX(s.created_at)                    AS last_session_at,
        SUM(CASE WHEN s.is_active = 1 AND s.seconds_remaining > 0
                 THEN 1 ELSE 0 END)          AS is_currently_active
      FROM users u
      LEFT JOIN sessions s ON s.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ?
    `;

  const users = search
    ? db.prepare(query).all(search, search, search, limit)
    : db.prepare(query).all(limit);

  return res.json({ success: true, users });
});

/* ─────────────────────────────────────────────────────────────────
   GET /api/admin/users/:id/sessions
   Returns full session history for one user.
───────────────────────────────────────────────────────────────── */
router.get('/users/:id/sessions', requireAdmin, (req, res) => {
  const sessions = db.prepare(`
    SELECT
      id, plan_label, seconds_total, seconds_remaining,
      is_active, amount_naira, paystack_ref, user_ip,
      created_at, updated_at
    FROM sessions
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.params.id);

  return res.json({ success: true, sessions });
});

/* ─────────────────────────────────────────────────────────────────
   POST /api/admin/sessions/:id/end
   Manually end (disconnect) any active session.
───────────────────────────────────────────────────────────────── */
router.post('/sessions/:id/end', requireAdmin, async (req, res) => {
  const session = db.prepare(`
    SELECT * FROM sessions WHERE id = ?
  `).get(req.params.id);

  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found.' });
  }

  /* Revoke iptables rule if session has an IP */
  if (session.user_ip) {
    await revokeAccess(session.user_ip).catch(err => {
      console.warn(`[admin] iptables revoke failed for ${session.user_ip}:`, err.message);
    });
  }

  /* Zero out the session */
  db.prepare(`
    UPDATE sessions
    SET is_active = 0, seconds_remaining = 0,
        updated_at = strftime('%s','now')
    WHERE id = ?
  `).run(req.params.id);

  console.log(`[admin] FORCE-END session ${req.params.id} (ip: ${session.user_ip})`);

  return res.json({ success: true });
});

module.exports = router;
