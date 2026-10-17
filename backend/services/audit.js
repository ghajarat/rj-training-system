// Audit log (FR2): who did what to whom, and when.
//
// Callers pass the same client they use for the change itself, so the change
// and its audit row commit (or roll back) together — there is never a user
// update without a matching log entry.
//
//   await audit.record(client, { actorId, action: audit.ACTIONS.USER_UPDATED,
//                                targetUserId, details: { before, after } });
const db = require('../db');

const ACTIONS = Object.freeze({
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',           // only for emails that exist
  USER_INVITED: 'USER_INVITED',
  SETUP_LINK_ISSUED: 'SETUP_LINK_ISSUED', // new invite link or password-reset link
  PASSWORD_SET: 'PASSWORD_SET',           // user completed a setup link
  USER_UPDATED: 'USER_UPDATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_REACTIVATED: 'USER_REACTIVATED',
});

const ACTION_VALUES = Object.values(ACTIONS);

async function record(queryable, { actorId = null, action, targetUserId = null, details = {} }) {
  if (!ACTION_VALUES.includes(action)) {
    throw new Error(`Unknown audit action: ${action}`);
  }
  await (queryable || db).query(
    `INSERT INTO audit_logs (actor_id, action, target_user_id, details)
     VALUES ($1, $2, $3, $4)`,
    [actorId, action, targetUserId, JSON.stringify(details)],
  );
}

module.exports = { ACTIONS, ACTION_VALUES, record };
