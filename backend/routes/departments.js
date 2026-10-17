// /api/departments — fills the department dropdowns on User Management.
// Admin only for now; Phase 4b can widen this when trainers assign plans
// to departments (FR8).
const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, authorize('Admin'));

// GET /api/departments  →  { departments: [{ id, name }] }
router.get('/', async (req, res) => {
  const { rows } = await db.query('SELECT dept_id, dept_name FROM departments ORDER BY dept_name');
  res.json({ departments: rows.map(r => ({ id: r.dept_id, name: r.dept_name })) });
});

module.exports = router;
