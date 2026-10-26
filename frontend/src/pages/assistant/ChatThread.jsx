// The conversation itself: question and answer bubbles, citations under each
// answer (FR11), a typing indicator while waiting, and the empty state with
// example questions. Scrolls to the newest message automatically.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import Button from '../../components/Button';
import Icon from '../../components/Icon';
import { initials } from '../../utils/format';
import Citations from './Citations';

const EXAMPLES = [
  'What do I do if a smoke hood indicator has turned pink?',
  'What is the procedure when a lavatory smoke detector goes off?',
  'Can a passenger put a power bank in checked baggage?',
  'Who decides if the aircraft can depart with unserviceable equipment?',
];

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

// Splits "Check the gauge [1]." into text and citation markers, so each [n]
// can be a button that opens that source.
function AnswerText({ text, onCite }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="bubble__text">
      {parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (!m) return part;
        const n = Number(m[1]);
        return (
          <button key={i} type="button" className="cite-marker" onClick={() => onCite(n)} aria-label={`Show source ${n}`}>
            {n}
          </button>
        );
      })}
    </p>
  );
}

const OUTCOME_NOTE = {
  not_found: { icon: 'search', label: 'Not found in the SOPs' },
  refused: { icon: 'shield', label: 'Outside what I can help with' },
};

function Message({ message, userInitials }) {
  const [openSource, setOpenSource] = useState(null);
  const isUser = message.role === 'user';
  const note = !isUser && OUTCOME_NOTE[message.outcome];

  return (
    <li className={`message message--${isUser ? 'user' : 'bot'} ${message.pending ? 'is-pending' : ''}`}>
      {!isUser && <span className="assistant__avatar assistant__avatar--bot" aria-hidden="true"><Icon name="sparkle" size={14} /></span>}
      <div className="message__body">
        <div className={`bubble ${note ? `bubble--${message.outcome}` : ''}`}>
          {note && (
            <span className="bubble__note"><Icon name={note.icon} size={14} />{note.label}</span>
          )}
          {isUser
            ? <p className="bubble__text">{message.text}</p>
            : <AnswerText text={message.text} onCite={(n) => setOpenSource((o) => (o === n ? null : n))} />}
          {!isUser && message.citations.length > 0 && (
            <Citations citations={message.citations} open={openSource} onToggle={setOpenSource} />
          )}
        </div>
        <span className="message__time">
          {message.pending ? 'Sending…' : timeFmt.format(new Date(message.createdAt))}
        </span>
      </div>
      {isUser && <span className="assistant__avatar assistant__avatar--user" aria-hidden="true">{userInitials}</span>}
    </li>
  );
}

function EmptyState({ documentCount, onExample, disabled }) {
  const { user } = useAuth();
  if (documentCount === 0) {
    return (
      <div className="chat-empty">
        <span className="chat-empty__icon"><Icon name="database" size={26} /></span>
        <strong>No SOPs to answer from yet</strong>
        <span>
          {user.role === 'Admin'
            ? 'Upload company SOPs in the SOP Library, and the assistant will answer from them.'
            : 'An administrator needs to upload company SOPs before the assistant can answer questions.'}
        </span>
      </div>
    );
  }
  return (
    <div className="chat-empty">
      <span className="chat-empty__icon"><Icon name="sparkle" size={26} /></span>
      <strong>Ask about any company procedure</strong>
      <span>Answers come only from Royal Jordanian SOPs, with numbered sources you can open. Try one of these:</span>
      <div className="chat-empty__examples">
        {EXAMPLES.map((q) => (
          <button key={q} type="button" className="example-question" onClick={() => onExample(q)} disabled={disabled}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ChatThread({
  messages, loading, error, onRetryLoad, sending, sendError, onDismissError, documentCount, onExample,
}) {
  const { user } = useAuth();
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sending, sendError]);

  return (
    <div className="chat" ref={scrollRef} aria-live="polite" aria-busy={sending || loading}>
      {loading && <p className="loading-text">Loading conversation…</p>}
      {error && (
        <div className="inline-error inline-error--row" role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={onRetryLoad}>Try again</Button>
        </div>
      )}

      {!loading && !error && messages.length === 0 && (
        <EmptyState documentCount={documentCount} onExample={onExample} disabled={sending} />
      )}

      {messages.length > 0 && (
        <ol className="chat__messages">
          {messages.map((m) => <Message key={m.id} message={m} userInitials={initials(user.fullName)} />)}
        </ol>
      )}

      {sending && (
        <div className="message message--bot" role="status">
          <span className="assistant__avatar assistant__avatar--bot" aria-hidden="true"><Icon name="sparkle" size={14} /></span>
          <div className="bubble bubble--typing">
            <span className="typing" aria-hidden="true"><i /><i /><i /></span>
            <span className="sr-only">The assistant is searching the SOPs and writing an answer…</span>
          </div>
        </div>
      )}

      {sendError && (
        <div className="inline-error inline-error--row chat__error" role="alert">
          <span><strong>Your question was not sent.</strong> {sendError} It is back in the box below, so you can send it again.</span>
          <button type="button" className="inline-success__close" onClick={onDismissError} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
