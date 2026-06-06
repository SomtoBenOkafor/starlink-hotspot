const express            = require('express');
const axios              = require('axios');
const { sessionHelpers } = require('../db');
const { requireAuth }    = require('../middleware/auth');
const { grantAccess, revokeAccess, getClientIp } = require('../network');
const { db }             = require('../db');

const router = express.Router();

router.use(requireAuth);

/* ────────────────────────────────────────────────────────────
   GET /api/session
───────────────────────────────────────────────────────────── */
router.get('/', (req, res) => {
  const session = sessionHelpers.findByUser.get(req.user.id);
  if (!session || session.seconds_remaining <= 0) {
    return res.json({ exists: false });
  }
  return res.json({
    exists:           true,
    sessionId:        session.id,
    planLabel:        session.plan_label,
    secondsRemaining: session.seconds_remaining,
    secondsTotal:     session.seconds_total,
    isActive:         session.is_active === 1,
  });
});

/* ────────────────────────────────────────────────────────────
   POST /api/session/verify-payment
   Body: { reference, planLabel, seconds }
───────────────────────────────────────────────────────────── */
router.post('/verify-payment', async (req, res) => {
  const { reference, planLabel, seconds } = req.body;

  if (!reference || !planLabel || !seconds) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }

  try {
    /* ── 1. Verify with Paystack ── */
    const paystackRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    const txn = paystackRes.data?.data;
    if (!txn || txn.status !== 'success') {
      return res.status(402).json({ success: false, message: 'Payment not confirmed by Paystack.' });
    }

    if (txn.customer?.email?.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ success: false, message: 'Payment email does not match account.' });
    }

    /* ── 2. Amount in Naira (Paystack stores in kobo) ── */
    const amountNaira = Math.round((txn.amount || 0) / 100);

    /* ── 3. End any previous paused session ── */
    const old = sessionHelpers.findByUser.get(req.user.id);
    if (old) {
      db.prepare(`UPDATE sessions SET is_active=0, seconds_remaining=0 WHERE id=?`).run(old.id);
      if (old.user_ip && old.is_active) await revokeAccess(old.user_ip).catch(() => {});
    }

    /* ── 4. Create session with amount saved ── */
    const userIp = getClientIp(req);
    const result = db.prepare(`
      INSERT INTO sessions
        (user_id, user_ip, plan_label, seconds_total, seconds_remaining, is_active, paystack_ref, amount_naira)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(req.user.id, userIp, planLabel, parseInt(seconds), parseInt(seconds), reference, amountNaira);

    /* ── 5. Grant iptables access ── */
    await grantAccess(userIp);

    console.log(`[session] NEW  user=${req.user.email}  ip=${userIp}  plan=${planLabel}  amount=₦${amountNaira}`);

    return res.json({
      success:          true,
      sessionId:        result.lastInsertRowid,
      planLabel,
      secondsRemaining: parseInt(seconds),
    });

  } catch (err) {
    if (err.response) {
      console.error('[verify-payment] Paystack error:', err.response.data);
      return res.status(502).json({ success: false, message: 'Could not reach Paystack. Try again.' });
    }
    console.error('[verify-payment]', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/session/resume
───────────────────────────────────────────────────────────── */
router.post('/resume', async (req, res) => {
  const session = sessionHelpers.findByUser.get(req.user.id);
  if (!session || session.seconds_remaining <= 0) {
    return res.status(404).json({ success: false, message: 'No active session found.' });
  }
  const userIp = getClientIp(req);
  sessionHelpers.setActive.run({ id: session.id, user_ip: userIp });
  await grantAccess(userIp);
  console.log(`[session] RESUME  user=${req.user.email}  ip=${userIp}  remaining=${session.seconds_remaining}s`);
  return res.json({ success: true, secondsRemaining: session.seconds_remaining, planLabel: session.plan_label });
});

/* ────────────────────────────────────────────────────────────
   POST /api/session/pause
   Body: { secondsRemaining }
───────────────────────────────────────────────────────────── */
router.post('/pause', async (req, res) => {
  const { secondsRemaining } = req.body;
  const session = sessionHelpers.findByUser.get(req.user.id);
  if (!session) return res.status(404).json({ success: false, message: 'No session found.' });
  sessionHelpers.pause.run({ id: session.id, seconds_remaining: Math.max(0, parseInt(secondsRemaining) || 0) });
  if (session.user_ip) await revokeAccess(session.user_ip);
  console.log(`[session] PAUSE  user=${req.user.email}  remaining=${secondsRemaining}s`);
  return res.json({ success: true });
});

/* ────────────────────────────────────────────────────────────
   POST /api/session/end
───────────────────────────────────────────────────────────── */
router.post('/end', async (req, res) => {
  const session = sessionHelpers.findByUser.get(req.user.id);
  if (!session) return res.status(404).json({ success: false, message: 'No session found.' });
  sessionHelpers.end.run({ id: session.id });
  if (session.user_ip) await revokeAccess(session.user_ip);
  console.log(`[session] END  user=${req.user.email}`);
  return res.json({ success: true });
});

module.exports = router;
