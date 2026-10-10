// Route guards.
//
//   router.get('/x', authenticate, handler)                      → any signed-in user
//   router.get('/x', authenticate, authorize('Admin'), handler)  → admins only
//   router.get('/x', authenticate, authorize('Trainer', 'Admin'), handler)
//
// authenticate verifies the JWT and puts { id, role, name } on req.user.
// authorize enforces role-based access control (NFR07).
const { verifyToken } = require('../utils/jwt');
const HttpError = require('../utils/httpError');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'AUTH_REQUIRED', 'Please sign in to continue.'));
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role, name: payload.name };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new HttpError(401, 'TOKEN_EXPIRED', 'Your session has expired. Please sign in again.'));
    }
    return next(new HttpError(401, 'TOKEN_INVALID', 'Your session is not valid. Please sign in again.'));
  }
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
