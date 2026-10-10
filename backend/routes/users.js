// /api/users — admin user management (FR19).
//
// Phase 2 only needs the read-only list, which doubles as the end-to-end
// proof that role-based access works: Admins get 200, everyone else 403.
// Invite / edit / deactivate land here in Phase 4a.
const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { toUserDto } = require('./auth');

const router = express.Router();

router.use(authenticate, authorize('Admin'));

// GET /api/users  →  { users: [...] }
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.user_id, u.full_name, u.email, u.created_at, r.role_name, d.dept_name
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN departments d ON d.dept_id = u.dept_id
      ORDER BY r.role_name, u.full_name`,
  );
  res.json({ users: rows.map(toUserDto) });
});

module.exports = router;
