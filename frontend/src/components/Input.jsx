// Labelled text input with optional leading icon, trailing slot and error.
//
//   <Input label="Corporate Email" icon="mail" type="email" value={v} onChange={...} />
//   <Input label="Password" icon="lock" type="password" error="Required" />
//
// Password inputs get a show/hide toggle automatically.
import { useId, useState } from 'react';
import Icon from './Icon';
import './Input.css';

export default function Input({
  label,
  icon,
  error,
  hint,
  type = 'text',
  trailing,
  className = '',
  id,
  ...rest
}) {
  const autoId = useId();
  const inputId = id || autoId;
  const messageId = `${inputId}-msg`;
  const [revealed, setRevealed] = useState(false);

  const isPassword = type === 'password';
  const effectiveType = isPassword && revealed ? 'text' : type;

  return (
    <div className={`field ${error ? 'field--error' : ''} ${className}`}>
      {(label || trailing) && (
        <div className="field__label-row">
          {label && <label htmlFor={inputId} className="field__label">{label}</label>}
          {trailing}
        </div>
      )}
      <div className="field__control">
        {icon && <Icon name={icon} size={16} className="field__icon" />}
        <input
          id={inputId}
          type={effectiveType}
          className={`field__input ${icon ? 'field__input--with-icon' : ''} ${isPassword ? 'field__input--with-toggle' : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            className="field__toggle"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
          >
            <Icon name={revealed ? 'eyeOff' : 'eye'} size={16} />
          </button>
        )}
      </div>
      {(error || hint) && (
        <p id={messageId} className={error ? 'field__error' : 'field__hint'}>{error || hint}</p>
      )}
    </div>
  );
}
