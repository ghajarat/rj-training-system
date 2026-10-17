// One-time setup links (FR1): used for invitations and admin-issued
// password resets.
//
// The raw token goes into the link the admin copies; only its SHA-256 is
// stored in users.setup_token_hash. A plain hash (not bcrypt) is enough here
// because the token is 256 bits of randomness — it cannot be guessed, so slow
// hashing adds nothing, and a fast hash lets us look the user up by it.
const crypto = require('crypto');
const config = require('../config');

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

// → { token, tokenHash, url }
// The expiry is set in SQL with expirySql() so it uses the database clock,
// the same clock the "is it still valid?" checks compare against.
function createSetupToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashToken(token),
    url: `${config.clientOrigin}/set-password?token=${token}`,
  };
}

// SQL expression for the expiry timestamp, given the caller's
// parameter placeholder, e.g. expirySql('$2') → NOW() + make_interval(hours => $2)
function expirySql(placeholder) {
  return `NOW() + make_interval(hours => ${placeholder}::int)`;
}

module.exports = { createSetupToken, hashToken, expirySql, expiresHours: () => config.setup.expiresHours };
