// "Suggested by your AI Assistant" on My Dashboard (Phase 6).
// Loads on its own, so waiting for the AI never holds up the rest of the page.
// When the AI could not word the reasons (source: 'rules') the card says so
// instead of presenting them as the assistant's words.
import { Link } from 'react-router-dom';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Icon from '../components/Icon';
import useFetch from '../hooks/useFetch';

const KINDS = {
  overdue: { label: 'Overdue', tone: 'danger' },
  due_soon: { label: 'Due soon', tone: 'warning' },
  continue: { label: 'Continue', tone: 'primary' },
  asked_about: { label: 'You asked about this', tone: 'accent' },
  next: { label: 'Up next', tone: 'neutral' },
};

export default function AiSuggestions() {
  const { data, error, loading, reload } = useFetch('/me/recommendations');
  const suggestions = data?.suggestions;

  return (
    <section className="card panel ai-slot" aria-labelledby="ai-title">
      <h2 id="ai-title" className="panel__title ai-slot__title">
        <Icon name="sparkle" size={16} className="stat-card__icon" />
        Suggested by your AI Assistant
      </h2>
      <div className="panel__body">
        {loading && !data && <p className="loading-text">Finding what to do next…</p>}
        {error && (
          <div className="inline-error inline-error--row" role="alert">
            <span>{error}</span>
            <Button variant="secondary" size="sm" onClick={reload}>Try again</Button>
          </div>
        )}
        {suggestions?.length === 0 && (
          <div className="empty-state">
            <strong>Nothing to suggest right now</strong>
            <span>You have no open courses. New suggestions appear when a trainer assigns you a plan.</span>
          </div>
        )}
        {suggestions?.length > 0 && (
          <ul className="suggestion-list">
            {suggestions.map((s) => {
              const kind = KINDS[s.kind] || KINDS.next;
              return (
                <li key={s.courseId} className="suggestion">
                  <div className="suggestion__text">
                    <Link to={`/materials?course=${s.courseId}`} className="table__link">{s.courseName}</Link>
                    <span className="table__sub">{s.planName}</span>
                    <p className="suggestion__reason">{s.reason}</p>
                  </div>
                  <Badge tone={kind.tone}>{kind.label}</Badge>
                </li>
              );
            })}
          </ul>
        )}
        {data?.source === 'rules' && suggestions?.length > 0 && (
          <p className="suggestion__note">Based on your plans and progress. The AI Assistant is not available right now.</p>
        )}
      </div>
    </section>
  );
}
