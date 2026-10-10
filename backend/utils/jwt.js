// Issue and verify JSON Web Tokens (OR05). The payload carries just enough
// to authorize a request without a database round trip: who the user is and
// which role they hold (NFR07).
const jwt = require('jsonwebtoken');
const config = require('../config');

function signToken(user) {
  return jwt.sign(
    { sub: user.user_id, role: user.role_name, name: user.full_name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn, issuer: config.jwt.issuer, algorithm: 'HS256' },
  );
}

// Throws (TokenExpiredError / JsonWebTokenError) when the token is invalid.
function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret, {
    issuer: config.jwt.issuer,
    algorithms: ['HS256'],
  });
}

module.exports = { signToken, verifyToken };
