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

module.exports = { hashPassword, verifyPassword, BCRYPT_ROUNDS };
