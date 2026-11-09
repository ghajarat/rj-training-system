// Phase 7: Trainer Overview and Analytics & ROI (Trainer + Admin).
//
//   GET /api/analytics/overview
//     → { summary, sentiment, plans, knowledgeGaps, trainees, definitions }
//   GET /api/analytics/roi
//     → { summary, kpis, sentimentByPlan, model }
//
// Read-only. All definitions live in services/analytics.js.
const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const analytics = require('../services/analytics');

const router = express.Router();

router.use(authenticate, authorize('Trainer', 'Admin'));

router.get('/overview', async (req, res) => {
  res.json(await analytics.overview());
});

router.get('/roi', async (req, res) => {
  res.json(await analytics.roi());
});

module.exports = router;
