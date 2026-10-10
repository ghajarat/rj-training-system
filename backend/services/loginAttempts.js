// Tracks failed sign-in attempts per email and locks the account for a while
// once the limit is hit (GP1 Fig. 22, "Account Locked").
//
// Kept in memory on purpose: the GP1 schema has no column for failed
// attempts, and a lock that clears on server restart is acceptable at this
// scale. If the team later adds lock columns to users, swap this module's
// internals for queries — the three exported functions stay the same.
const config = require('../config');

const attempts = new Map(); // email -> { count, lockedUntil }

function getLock(email) {
  const entry = attempts.get(email);
  if (!entry || !entry.lockedUntil) return null;
  if (entry.lockedUntil <= Date.now()) {
    attempts.delete(email);
    return null;
  }
  return entry.lockedUntil;
}

function recordFailure(email) {
  const entry = attempts.get(email) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= config.login.maxAttempts) {
    entry.lockedUntil = Date.now() + config.login.lockMinutes * 60 * 1000;
  }
  attempts.set(email, entry);
  return {
    locked: Boolean(entry.lockedUntil),
    remaining: Math.max(config.login.maxAttempts - entry.count, 0),
  };
}

function clearFailures(email) {
  attempts.delete(email);
}

module.exports = { getLock, recordFailure, clearFailures };
