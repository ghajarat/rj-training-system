// Phase 8: System Health (Admin only).
//
//   GET /api/system/health → { status, checkedAt, checks: { database, migrations,
//                              sopIndex, ai, sentiment, storage, accounts, server } }
//
// Unlike the public GET /api/health (a one-line "the API is up" for
// monitoring), this shows details about the installation, so it is for
// Admins only. Read-only; never returns secrets.
const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const systemHealth = require('../services/systemHealth');

const router = express.Router();

router.use(authenticate, authorize('Admin'));

router.get('/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await systemHealth.check());
});

module.exports = router;
