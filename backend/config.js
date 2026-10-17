// Central place for settings read from .env, validated once at startup so a
// missing secret fails loudly instead of surfacing as a confusing 500 later.
require('dotenv').config();

const required = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`${key} is not set — copy .env.example to .env and fill it in.`);
  }
}

if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}

module.exports = {
  port: Number(process.env.PORT) || 5000,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  jwt: {
    secret: process.env.JWT_SECRET,
    // Token lifetime. "Remember this device" only changes where the browser
    // keeps the token; the server-side expiry is the same for everyone.
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    issuer: 'rj-training-system',
  },

  // Login State Transition Diagram (GP1 Fig. 22): Authentication Failed →
  // Account Locked once the maximum number of attempts is reached.
  login: {
    maxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS) || 5,
    lockMinutes: Number(process.env.LOGIN_LOCK_MINUTES) || 15,
  },

  // FR1: how long an invitation / password-reset link stays valid.
  setup: {
    expiresHours: Number(process.env.INVITE_EXPIRES_HOURS) || 72,
  },
};
