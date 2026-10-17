// File picker with drag-and-drop and a client-side type/size check.
//
//   <FileUpload label="Material file" accept={['pdf', 'docx']} maxMb={100}
//               file={file} onChange={setFile} error={errors.file} />
//
// The check here only saves the user a wasted upload; the backend checks the
// type, size and real file contents again (FR7).
import { useId, useRef, useState } from 'react';
import { formatBytes } from '../utils/format';
import Icon from './Icon';
import './FileUpload.css';

export default function FileUpload({
  label, accept, maxMb, file, onChange, error, hint, disabled = false,
}) {
  const inputId = useId();
  const messageId = `${inputId}-msg`;
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState(null);

  const acceptAttr = accept.map((ext) => `.${ext}`).join(',');
  const shownError = localError || error;

  const pick = (selected) => {
    if (!selected) return;
    const ext = selected.name.split('.').pop().toLowerCase();
    if (!accept.includes(ext)) {
      setLocalError(`Choose a ${accept.map((e) => e.toUpperCase()).join(', ')} file.`);
      return;
    }
    if (selected.size > maxMb * 1024 * 1024) {
      setLocalError(`This file is ${formatBytes(selected.size)}. The limit is ${maxMb} MB.`);
      return;
    }
    setLocalError(null);
    onChange(selected);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) pick(event.dataTransfer.files[0]);
  };

  const clear = () => {
    onChange(null);
    setLocalError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className={`field ${shownError ? 'field--error' : ''}`}>
      {label && <label htmlFor={inputId} className="field__label">{label}</label>}

      {file ? (
        <div className="file-upload__chosen">
          <Icon name="file" size={18} />
          <span className="file-upload__name" title={file.name}>{file.name}</span>
          <span className="file-upload__size">{formatBytes(file.size)}</span>
          <button type="button" className="file-upload__clear" onClick={clear} disabled={disabled} aria-label="Remove file">
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className={`file-upload__zone ${dragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <Icon name="upload" size={20} />
          <span><strong>Choose a file</strong> or drag it here</span>
          <small>{accept.map((e) => e.toUpperCase()).join(', ')} · up to {maxMb} MB</small>
        </label>
      )}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        accept={acceptAttr}
        disabled={disabled}
        aria-describedby={shownError || hint ? messageId : undefined}
        onChange={(e) => pick(e.target.files[0])}
      />

      {(shownError || hint) && (
        <p id={messageId} className={shownError ? 'field__error' : 'field__hint'}>{shownError || hint}</p>
      )}
    </div>
  );
}
