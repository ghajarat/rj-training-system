// One trainee's plans and per-course progress (FR9). Read-only.
import { Link } from 'react-router-dom';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import ProgressBar from '../../components/ProgressBar';
import useFetch from '../../hooks/useFetch';
import { formatDay, timeAgo } from '../../utils/format';
import { PROGRESS_STATUS, toneForStatus } from './trainingOptions';

export default function TraineeProgressModal({ trainee, onClose }) {
  const detail = useFetch(`/trainees/${trainee.id}/progress`);
  const plans = detail.data?.plans || [];

  return (
    <Modal
      open
      size="lg"
      title={trainee.fullName}
      description={`${trainee.department || 'No department'} · ${trainee.email}`}
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {detail.error && (
        <div className="inline-error inline-error--row" role="alert">
          <span>{detail.error}</span>
          <Button variant="secondary" size="sm" onClick={detail.reload}>Try again</Button>
        </div>
      )}
      {!detail.data && !detail.error && <p className="loading-text">Loading progress…</p>}
      {detail.data && plans.length === 0 && (
        <div className="empty-state">
          <strong>No plans assigned</strong>
          <span>Assign a plan from its page under Training Plans.</span>
        </div>
      )}

      <div className="trainee-plans">
        {plans.map((p) => {
          const status = PROGRESS_STATUS[p.status];
          return (
            <section key={p.planId} className="trainee-plan">
              <header className="trainee-plan__head">
                <div>
                  <Link to={`/plans/${p.planId}`} className="table__link" onClick={onClose}>{p.planName}</Link>
                  <small className="table__sub">
                    Due {formatDay(p.dueDate)} · last activity {timeAgo(p.lastActivityAt).toLowerCase()}
                  </small>
                </div>
                <Badge tone={status.tone} dot>{status.label}</Badge>
              </header>
              <ProgressBar value={p.completionPct} tone={toneForStatus(p.status)} label={`${p.planName} completion`} />
              <ol className="trainee-plan__courses">
                {p.courses.map((c) => (
                  <li key={c.id}>
                    <span>{c.position}. {c.name}</span>
                    <ProgressBar value={c.completionPct} tone={c.completionPct === 100 ? 'success' : 'primary'} label={`${c.name} completion`} />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
