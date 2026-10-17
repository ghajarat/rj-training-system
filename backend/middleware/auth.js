// Route guards.
//
//   router.get('/x', authenticate, handler)                      → any signed-in user
//   router.get('/x', authenticate, authorize('Admin'), handler)  → admins only
//   router.get('/x', authenticate, authorize('Trainer', 'Admin'), handler)
//
// authenticate verifies the JWT, then loads the user's CURRENT role and
// status from the database and puts { id, role, name } on req.user.
// authorize enforces role-based access control (NFR07).
const db = require('../db');
const { verifyToken } = require('../utils/jwt');
const HttpError = require('../utils/httpError');

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new HttpError(401, 'TOKEN_EXPIRED', 'Your session has expired. Please sign in again.');
    }
    throw new HttpError(401, 'TOKEN_INVALID', 'Your session is not valid. Please sign in again.');
  }

  // FR19: a signature check alone would keep a deactivated user (or a demoted
  // admin) working until the token expires. One primary-key lookup per
  // request makes deactivation and role changes take effect immediately.
  const { rows } = await db.query(
    `SELECT u.user_id, u.full_name, u.is_active, r.role_name
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = $1`,
    [payload.sub],
  );
  const user = rows[0];

  if (!user) {
    throw new HttpError(401, 'TOKEN_INVALID', 'This account no longer exists.');
  }
  if (!user.is_active) {
    throw new HttpError(401, 'ACCOUNT_DEACTIVATED',
      'Your account has been deactivated. Please contact your administrator.');
  }

  req.user = { id: user.user_id, role: user.role_name, name: user.full_name };
  next();
}

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new HttpError(401, 'AUTH_REQUIRED', 'Please sign in to continue.'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new HttpError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'));
    }
    return next();
  };
}

module.exports = { authenticate, authorize };
