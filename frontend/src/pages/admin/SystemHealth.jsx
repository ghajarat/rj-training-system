// System Health (Phase 8), /admin/system-health, Admin only.
//
// One card per check from GET /api/system/health: database, migrations, SOP
// index, AI services, sentiment backlog, file storage, accounts and the API
// server. Each card shows OK / Warning / Error and, when something needs
// doing, a plain sentence saying what. Nothing here changes anything, and no
// AI service is called (checking health must not cost money).
//
// There is no design screenshot for this page; it uses the same cards and
// badges as the rest of the app.
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import useFetch from '../../hooks/useFetch';
import { formatBytes, formatDateTime, plural } from '../../utils/format';
import PageHeader from '../PageHeader';
import './systemHealth.css';

const STATUS = {
  ok: { label: 'OK', tone: 'success' },
  warning: { label: 'Warning', tone: 'warning' },
  error: { label: 'Error', tone: 'danger' },
};

const OVERALL = {
  ok: 'All systems are working.',
  warning: 'The system is working, but something needs a look.',
  error: 'Something is not working. See the cards marked Error.',
};

function uptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

const yesNo = (v) => (v ? 'Set' : 'Missing');

// Facts shown per check: [label, value] pairs. A check that failed to run has
// only { status, message }, so every field is optional.
const CARDS = [
  {
    key: 'database',
    title: 'Database',
    facts: (c) => [
      ['Response time', c.latencyMs != null && `${c.latencyMs} ms`],
      ['PostgreSQL', c.version],
      ['pgvector', c.pgvector || 'Not installed'],
      ['Size', c.sizeBytes != null && formatBytes(c.sizeBytes)],
    ],
  },
  {
    key: 'migrations',
    title: 'Database migrations',
    facts: (c) => [
      ['Applied', c.applied],
      ['Latest', c.latest],
      ['Pending', c.pending && (c.pending.length ? c.pending.join(', ') : 'None')],
    ],
  },
  {
    key: 'sopIndex',
    title: 'SOP index (AI Assistant)',
    facts: (c) => [
      ['Ready', c.ready],
      ['Indexing', c.processing],
      ['Failed', c.failed],
      ['Searchable passages', c.passages?.toLocaleString()],
    ],
    extra: (c) => c.failedDocuments?.length > 0 && (
      <ul className="health-card__list">
        {c.failedDocuments.map((d) => <li key={d.title}><strong>{d.title}</strong>{d.reason && ` — ${d.reason}`}</li>)}
      </ul>
    ),
  },
  {
    key: 'ai',
    title: 'AI services',
    facts: (c) => [
      ['Mode', c.mode],
      ['Answer model', c.llmModel && `${c.llmModel} (${c.llmProvider})`],
      ['Embedding model', c.embeddingModel],
      ['OpenAI key', c.keysSet && yesNo(c.keysSet.openai)],
      ['Anthropic key', c.keysSet && yesNo(c.keysSet.anthropic)],
    ],
  },
  {
    key: 'sentiment',
    title: 'Feedback sentiment',
    facts: (c) => [
      ['Scored comments', c.scored],
      ['Waiting for a score', c.pending],
    ],
  },
  {
    key: 'storage',
    title: 'File storage',
    facts: (c) => [
      ['Training materials', c.materials && `${plural(c.materials.files, 'file')} · ${formatBytes(c.materials.bytes)}`],
      ['SOP files', c.sops && `${plural(c.sops.files, 'file')} · ${formatBytes(c.sops.bytes)}`],
      ['Missing files', c.missingFiles],
    ],
  },
  {
    key: 'accounts',
    title: 'Accounts & sign-ins',
    facts: (c) => [
      ['Active users', c.active],
      ['Active admins', c.activeAdmins],
      ['Pending invitations', c.pendingInvites],
      ['Deactivated', c.deactivated],
      ['Sign-ins (24 h)', c.logins24h],
      ['Failed sign-ins (24 h)', c.failedLogins24h],
    ],
  },
  {
    key: 'server',
    title: 'API server',
    facts: (c) => [
      ['Up for', c.uptimeSeconds != null && uptime(c.uptimeSeconds)],
      ['Started', c.startedAt && formatDateTime(c.startedAt)],
      ['Node.js', c.nodeVersion],
      ['Memory', c.memoryMb != null && `${c.memoryMb} MB`],
      ['Environment', c.environment],
    ],
  },
];

export default function SystemHealth() {
  const { data, error, loading, reload } = useFetch('/system/health');
  const overall = data && STATUS[data.status];

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="System Health"
        subtitle="Database, AI services, SOP index and storage at a glance."
        actions={(
          <Button variant="secondary" icon="refresh" onClick={reload} loading={loading && Boolean(data)}>
            Check again
          </Button>
        )}
      />

      {error && (
        <div className="inline-error inline-error--row page-alert" role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={reload}>Try again</Button>
        </div>
      )}
      {!data && !error && <p className="loading-text">Running checks…</p>}

      {data && (
        <>
          <div className={`card health-banner health-banner--${data.status}`} role="status">
            <Badge tone={overall.tone} dot>{overall.label}</Badge>
            <strong>{OVERALL[data.status]}</strong>
            <span className="health-banner__time">Checked {formatDateTime(data.checkedAt)}</span>
          </div>

          <div className={`health-grid ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
            {CARDS.map((card) => {
              const check = data.checks[card.key];
              if (!check) return null;
              const status = STATUS[check.status] || STATUS.error;
              const facts = card.facts(check).filter(([, v]) => v !== undefined && v !== null && v !== false);
              return (
                <section key={card.key} className="card health-card" aria-labelledby={`health-${card.key}`}>
                  <header className="health-card__head">
                    <h2 id={`health-${card.key}`}>{card.title}</h2>
                    <Badge tone={status.tone} dot>{status.label}</Badge>
                  </header>
                  {check.message && (
                    <p className={`health-card__message health-card__message--${check.status}`}>{check.message}</p>
                  )}
                  {facts.length > 0 && (
                    <dl className="health-card__facts">
                      {facts.map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {card.extra?.(check)}
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
