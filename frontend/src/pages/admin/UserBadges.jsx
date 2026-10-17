// Role and status pills used on User Management and the Audit Log.
import Badge from '../../components/Badge';
import { ROLE_TONE, STATUS_INFO } from './userOptions';

export function RoleBadge({ role }) {
  return <Badge tone={ROLE_TONE[role] || 'neutral'}>{role}</Badge>;
}

export function StatusBadge({ status }) {
  const info = STATUS_INFO[status] || { label: status, tone: 'neutral' };
  return <Badge tone={info.tone} dot>{info.label}</Badge>;
}
