// Left column of the AI Assistant: my conversations, newest first, grouped
// into Today and Earlier, with a search box that filters by title (FR12).
import { useState } from 'react';
import Button from '../../components/Button';
import Icon from '../../components/Icon';
import Input from '../../components/Input';
import { timeAgo } from '../../utils/format';

function isToday(value) {
  return new Date(value).toDateString() === new Date().toDateString();
}

export default function SessionList({ sessions, loading, error, onRetry, activeId, onOpen, onDelete, disabled }) {
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const shown = term ? sessions.filter((s) => s.title.toLowerCase().includes(term)) : sessions;
  const groups = [
    { label: 'Today', items: shown.filter((s) => isToday(s.lastMessageAt)) },
    { label: 'Earlier', items: shown.filter((s) => !isToday(s.lastMessageAt)) },
  ].filter((g) => g.items.length);

  return (
    <div className="sessions">
      <div className="sessions__search">
        <Input icon="search" type="search" placeholder="Search conversations" aria-label="Search conversations"
          value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
      </div>

      <div className="sessions__list">
        {loading && <p className="loading-text">Loading conversations…</p>}
        {error && (
          <div className="inline-error inline-error--row" role="alert">
            <span>{error}</span>
            <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
          </div>
        )}
        {!loading && !error && sessions.length === 0 && (
          <p className="sessions__empty">No conversations yet. Your questions and answers will be saved here.</p>
        )}
        {!loading && sessions.length > 0 && shown.length === 0 && (
          <p className="sessions__empty">No conversation matches “{search.trim()}”.</p>
        )}

        {groups.map((group) => (
          <div key={group.label} className="sessions__group">
            <h3 className="sessions__group-title">{group.label}</h3>
            <ul>
              {group.items.map((s) => (
                <li key={s.id} className={`session ${s.id === activeId ? 'is-active' : ''}`}>
                  <button type="button" className="session__open" onClick={() => onOpen(s.id)} disabled={disabled}
                    aria-current={s.id === activeId ? 'true' : undefined}>
                    <span className="session__top">
                      <span className="session__title">{s.title}</span>
                      <span className="session__when">{timeAgo(s.lastMessageAt)}</span>
                    </span>
                    {s.preview && <span className="session__preview">{s.preview}</span>}
                  </button>
                  <button type="button" className="session__delete" onClick={() => onDelete(s)} disabled={disabled}
                    aria-label={`Delete conversation “${s.title}”`}>
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
