// Labelled multi-line text field, styled like <Input>.
//
//   <Textarea label="Description" rows={3} value={v} onChange={...} hint="Optional" />
import { useId } from 'react';
import './Input.css';

export default function Textarea({ label, error, hint, className = '', id, rows = 3, ...rest }) {
  const autoId = useId();
  const inputId = id || autoId;
  const messageId = `${inputId}-msg`;

  return (
    <div className={`field ${error ? 'field--error' : ''} ${className}`}>
      {label && <label htmlFor={inputId} className="field__label">{label}</label>}
      <textarea
        id={inputId}
        rows={rows}
        className="field__input field__input--textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        {...rest}
      />
      {(error || hint) && (
        <p id={messageId} className={error ? 'field__error' : 'field__hint'}>{error || hint}</p>
      )}
    </div>
  );
}
