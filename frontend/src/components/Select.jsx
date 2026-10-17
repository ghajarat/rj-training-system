// Labelled native <select>, styled to match <Input>.
//
//   <Select label="Role" value={role} onChange={e => setRole(e.target.value)}
//           options={[{ value: 'Trainee', label: 'Trainee' }, ...]} placeholder="All roles" />
//
// `placeholder` adds a first option with value "" (e.g. "All roles").
import { useId } from 'react';
import './Input.css';
import './Select.css';

export default function Select({
  label, options, placeholder, error, hint, className = '', id, ...rest
}) {
  const autoId = useId();
  const selectId = id || autoId;
  const messageId = `${selectId}-msg`;

  return (
    <div className={`field ${error ? 'field--error' : ''} ${className}`}>
      {label && <label htmlFor={selectId} className="field__label">{label}</label>}
      <div className="field__control">
        <select
          id={selectId}
          className="field__input select"
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          {...rest}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {(error || hint) && (
        <p id={messageId} className={error ? 'field__error' : 'field__hint'}>{error || hint}</p>
      )}
    </div>
  );
}
