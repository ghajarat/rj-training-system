// bcrypt wrapper (NFR05). Use these helpers everywhere a password is set or
// checked so the cost factor stays consistent with the seed script.
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 12;

// A real bcrypt hash of a random string. Comparing against it when the email
// doesn't exist makes "unknown email" take as long as "wrong password", so
// response timing can't be used to discover which emails are registered.
const DUMMY_HASH = '$2b$12$37.uK3j0ybBqiB9vb91ejuMgrdtA5eICY3kHu98tOdQ5/U1sLIDlq';

function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash || DUMMY_HASH);
}

// Password rule for set-password (FR1). The frontend shows the same rule,
// but the backend is the one that enforces it.
// The 72-character cap is bcrypt's own limit: it ignores anything longer.
const PASSWORD_RULE = 'Use 10 to 72 characters, including at least one letter and one number.';

// → null when acceptable, otherwise the message to show
function checkPasswordStrength(plain) {
  if (typeof plain !== 'string' || plain.length < 10 || Buffer.byteLength(plain, 'utf8') > 72
      || !/[A-Za-z]/.test(plain) || !/\d/.test(plain)) {
    return PASSWORD_RULE;
  }
  return null;
}

module.exports = { hashPassword, verifyPassword, checkPasswordStrength, PASSWORD_RULE, BCRYPT_ROUNDS };
