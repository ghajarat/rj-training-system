// Upload a new SOP, or re-upload / rename an existing one (FR13).
//
//   <SopUploadModal onClose onSaved />             new SOP
//   <SopUploadModal doc={doc} onClose onSaved />   new file and/or new title
//
// The title defaults to the file name. The server checks type, size and
// content again, and refuses a title another SOP already has.
import { useState } from 'react';
import { getErrorMessage } from '../../api/client';
import { SOP_EXTENSIONS, SOP_MAX_MB, updateDocument, uploadDocument } from '../../api/documents';
import Button from '../../components/Button';
import FileUpload from '../../components/FileUpload';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import ProgressBar from '../../components/ProgressBar';

const FILE_ERRORS = ['FILE_TYPE_NOT_ALLOWED', 'FILE_TOO_LARGE', 'FILE_CONTENT_MISMATCH'];

function titleFromFileName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
}

export default function SopUploadModal({ doc, onClose, onSaved }) {
  const editing = Boolean(doc);
  const [title, setTitle] = useState(doc?.title || '');
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploadPct, setUploadPct] = useState(null);

  const chooseFile = (f) => {
    setFile(f);
    setErrors((e) => ({ ...e, file: undefined }));
    if (f && !editing && !title.trim()) setTitle(titleFromFileName(f.name));
  };

  const validate = () => {
    const next = {};
    const t = title.trim();
    if (t && (t.length < 2 || t.length > 255)) next.title = 'Enter a title of 2 to 255 characters.';
    if (!editing && !file) next.file = 'Choose a PDF, DOCX or TXT file.';
    if (editing && !file && t === doc.title) next.file = 'Choose a new file, or change the title.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSaving(true);
    const onProgress = file ? (e) => { if (e.total) setUploadPct(Math.round((e.loaded / e.total) * 100)); } : undefined;
    try {
      const t = title.trim();
      const saved = editing
        ? await updateDocument(doc.id, t !== doc.title ? t : '', file, onProgress)
        : await uploadDocument(t, file, onProgress);
      onSaved(saved, Boolean(file));
    } catch (err) {
      const code = err.response?.data?.error?.code;
      if (FILE_ERRORS.includes(code)) setErrors((e) => ({ ...e, file: getErrorMessage(err) }));
      else if (code === 'DOCUMENT_EXISTS') setErrors((e) => ({ ...e, title: getErrorMessage(err) }));
      else setFormError(getErrorMessage(err));
      setSaving(false);
      setUploadPct(null);
    }
  };

  return (
    <Modal
      open
      title={editing ? 'Re-upload or rename SOP' : 'Upload SOP'}
      description={editing
        ? 'A new file replaces the old one and is indexed again. The old version keeps answering until the new one is ready.'
        : 'PDF, Word (DOCX) or plain text. Scanned PDFs need text recognition (OCR) first.'}
      onClose={onClose}
      busy={saving}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="sop-form" icon={editing ? 'check' : 'upload'} loading={saving}>
            {editing ? 'Save' : 'Upload'}
          </Button>
        </>
      )}
    >
      <form id="sop-form" className="modal-form" onSubmit={handleSubmit} noValidate>
        {formError && <p className="inline-error" role="alert">{formError}</p>}

        <FileUpload label={editing ? 'New file (optional)' : 'File'} accept={SOP_EXTENSIONS} maxMb={SOP_MAX_MB}
          file={file} onChange={chooseFile} error={errors.file} disabled={saving} />

        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title}
          maxLength={255} placeholder="e.g. Cabin Crew Pre-Flight Safety Check"
          hint={editing ? undefined : 'Shown in citations. Defaults to the file name.'} />

        {uploadPct !== null && (
          <div className="sop-upload-progress" aria-live="polite">
            <span>{uploadPct < 100 ? 'Uploading…' : 'Checking the file…'}</span>
            <ProgressBar value={uploadPct} tone="accent" label="Upload progress" />
          </div>
        )}
      </form>
    </Modal>
  );
}
