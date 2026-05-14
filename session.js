const express            = require('express');
const axios              = require('axios');
const { sessionHelpers } = require('../db');
const { requireAuth }    = require('../middleware/auth');
const { grantAccess, revokeAccess, getClientIp } = require('../network');

const router = express.Router();

/* All session routes require a logged-in user */
router.use(requireAuth);

/* ────────────────────────────────────────────────────────────
   GET /api/session
   Returns the user's current session (if any remaining time).
──────────────────────────────────────────────────────────── */
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
   POST /api/verify-payment
   Body: { reference, planLabel, seconds }
   1. Verifies payment with Paystack
   2. Creates a session in the DB
   3. Opens iptables for the user's IP
──────────────────────────────────────────────────────────── */
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

    /* Extra sanity check: make sure the email matches the logged-in user */
    if (txn.customer?.email?.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ success: false, message: 'Payment email does not match account.' });
    }

    /* ── 2. Create session in DB ── */
    const userIp = getClientIp(req);

    /* End any old paused sessions first */
    const oldSession = sessionHelpers.findByUser.get(req.user.id);
    if (oldSession) {
      sessionHelpers.end.run({ id: oldSession.id });
      /* Revoke old IP rule if different */
      if (oldSession.user_ip && oldSession.is_active) {
        await revokeAccess(oldSession.user_ip).catch(() => {});
      }
    }

    const result = sessionHelpers.create.run({
      user_id:           req.user.id,
      user_ip:           userIp,
      plan_label:        planLabel,
      seconds_total:     parseInt(seconds),
      seconds_remaining: parseInt(seconds),
      paystack_ref:      reference,
    });

    /* ── 3. Open internet access ── */
    await grantAccess(userIp);

    console.log(`[session] NEW  user=${req.user.email}  ip=${userIp}  plan=${planLabel}`);

    return res.json({
      success:    true,
      sessionId:  result.lastInsertRowid,
      planLabel,
      secondsRemaining: parseInt(seconds),
    });

  } catch (err) {
    /* Paystack API network error */
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
   User reconnects — re-opens their iptables rule.
──────────────────────────────────────────────────────────── */
router.post('/resume', async (req, res) => {
  const session = sessionHelpers.findByUser.get(req.user.id);

  if (!session || session.seconds_remaining <= 0) {
    return res.status(404).json({ success: false, message: 'No active session found.' });
  }

  const userIp = getClientIp(req);

  /* Update IP in case the user got a new DHCP lease */
  sessionHelpers.setActive.run({ id: session.id, user_ip: userIp });

  await grantAccess(userIp);

  console.log(`[session] RESUME  user=${req.user.email}  ip=${userIp}  remaining=${session.seconds_remaining}s`);

  return res.json({
    success:          true,
    secondsRemaining: session.seconds_remaining,
    planLabel:        session.plan_label,
  });
});

/* ────────────────────────────────────────────────────────────
   POST /api/session/pause
   Body: { secondsRemaining }
   User disconnects — saves remaining time, blocks their IP.
──────────────────────────────────────────────────────────── */
router.post('/pause', async (req, res) => {
  const { secondsRemaining } = req.body;
  const session = sessionHelpers.findByUser.get(req.user.id);

  if (!session) {
    return res.status(404).json({ success: false, message: 'No session found.' });
  }

  /* Save remaining time */
  sessionHelpers.pause.run({
    id:                session.id,
    seconds_remaining: Math.max(0, parseInt(secondsRemaining) || 0),
  });

  /* Revoke access */
  if (session.user_ip) {
    await revokeAccess(session.user_ip);
  }

  console.log(`[session] PAUSE  user=${req.user.email}  remaining=${secondsRemaining}s`);

  return res.json({ success: true });
});

/* ────────────────────────────────────────────────────────────
   POST /api/session/end
   Session permanently ended — zeroes remaining time, blocks IP.
──────────────────────────────────────────────────────────── */
router.post('/end', async (req, res) => {
  const session = sessionHelpers.findByUser.get(req.user.id);

  if (!session) {
    return res.status(404).json({ success: false, message: 'No session found.' });
  }

  sessionHelpers.end.run({ id: session.id });

  if (session.user_ip) {
    await revokeAccess(session.user_ip);
  }

  console.log(`[session] END  user=${req.user.email}`);

  return res.json({ success: true });
});

module.exports = router;
