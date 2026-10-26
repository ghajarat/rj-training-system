// The question box. Enter sends, Shift+Enter adds a new line. Disabled while
// an answer is on its way, so questions cannot overlap.
import { useEffect, useRef } from 'react';
import { QUESTION_MAX } from '../../api/chat';
import Icon from '../../components/Icon';

export default function Composer({ value, onChange, onSend, sending }) {
  const ref = useRef(null);
  const text = value.trim();
  const tooLong = value.length > QUESTION_MAX;

  // Grows with its content, up to about six lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  // Back in the box after sending, ready for the next question.
  useEffect(() => {
    if (!sending) ref.current?.focus({ preventScroll: true });
  }, [sending]);

  const submit = () => {
    if (!text || tooLong || sending) return;
    onSend(text);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className={`composer__box ${tooLong ? 'is-invalid' : ''}`}>
        <label htmlFor="assistant-question" className="sr-only">Your question</label>
        <textarea
          id="assistant-question"
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={sending ? 'Waiting for the answer…' : 'Ask about an SOP or procedure…'}
          disabled={sending}
          aria-describedby="assistant-question-hint"
        />
        <button type="submit" className="composer__send" disabled={!text || tooLong || sending} aria-label="Send question">
          <Icon name="send" size={18} />
        </button>
      </div>
      <p id="assistant-question-hint" className={`composer__hint ${tooLong ? 'text-danger' : ''}`}>
        {tooLong
          ? `Questions can be at most ${QUESTION_MAX} characters (${value.length} now).`
          : 'Enter to send · Shift+Enter for a new line · Answers can be wrong: check the source before acting.'}
      </p>
    </form>
  );
}
