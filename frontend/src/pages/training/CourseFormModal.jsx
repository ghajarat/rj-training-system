// Add or edit a course and its material (FR7).
//
//   <CourseFormModal plans={plans} onClose={...} onSaved={...} />          add, pick the plan
//   <CourseFormModal fixedPlan={plan} onClose={...} onSaved={...} />      add to this plan
//   <CourseFormModal course={course} onClose={...} onSaved={...} />       edit
//
// The material is a file (PDF, DOCX, PPTX, MP4), a web link, or nothing yet.
// When editing, "Keep current" leaves it untouched.
import { useState } from 'react';
import { getErrorMessage } from '../../api/client';
import {
  createCourse, updateCourse, MATERIAL_EXTENSIONS, MATERIAL_MAX_MB,
} from '../../api/training';
import Button from '../../components/Button';
import FileUpload from '../../components/FileUpload';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import ProgressBar from '../../components/ProgressBar';
import Select from '../../components/Select';
import { MATERIAL_INFO } from './trainingOptions';

const FILE_ERRORS = ['FILE_TYPE_NOT_ALLOWED', 'FILE_CONTENT_MISMATCH', 'FILE_TOO_LARGE'];

function isHttpUrl(text) {
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

export default function CourseFormModal({ course, plans = [], fixedPlan, onClose, onSaved }) {
  const editing = Boolean(course);
  const hasMaterial = Boolean(course?.material);

  const [form, setForm] = useState({
    name: course?.name || '',
    planId: fixedPlan?.id || '',
    duration: course?.durationMinutes ? String(course.durationMinutes) : '',
    // keep | file | link | none
    mode: editing ? 'keep' : 'file',
    link: course?.material?.type === 'link' ? course.material.url : '',
  });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploadPct, setUploadPct] = useState(null);

  const set = (field) => (event) => {
    setForm((f) => ({ ...f, [field]: event.target.value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const modes = editing
    ? [
      { value: 'keep', label: hasMaterial ? 'Keep current' : 'No material' },
      { value: 'file', label: hasMaterial ? 'Replace with file' : 'Upload file' },
      { value: 'link', label: 'Web link' },
      ...(hasMaterial ? [{ value: 'none', label: 'Remove' }] : []),
    ]
    : [
      { value: 'file', label: 'Upload file' },
      { value: 'link', label: 'Web link' },
      { value: 'none', label: 'Add later' },
    ];

  const validate = () => {
    const next = {};
    const name = form.name.trim();
    if (name.length < 2 || name.length > 150) next.name = 'Enter a course name of 2 to 150 characters.';
    if (!editing && !form.planId) next.planId = 'Choose the training plan this course belongs to.';
    if (form.duration !== '') {
      const minutes = Number(form.duration);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10000) {
        next.duration = 'Enter whole minutes between 1 and 10000.';
      }
    }
    if (form.mode === 'file' && !file) next.file = 'Choose a file to upload.';
    if (form.mode === 'link' && !isHttpUrl(form.link.trim())) {
      next.link = 'Enter a full web address, starting with https://';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  // Only the fields the API needs for the chosen material mode.
  const buildFields = () => {
    const fields = { name: form.name.trim(), durationMinutes: form.duration };
    if (!editing) fields.planId = form.planId;
    if (form.mode === 'link') fields.link = form.link.trim();
    if (form.mode === 'none' && editing) fields.link = '';   // '' = remove material
    return fields;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setSaving(true);
    const upload = form.mode === 'file' ? file : null;
    const onProgress = upload
      ? (e) => { if (e.total) setUploadPct(Math.round((e.loaded / e.total) * 100)); }
      : undefined;
    try {
      const result = editing
        ? await updateCourse(course.id, buildFields(), upload, onProgress)
        : await createCourse(buildFields(), upload, onProgress);
      onSaved(result.course, !editing);
    } catch (err) {
      const code = err.response?.data?.error?.code;
      if (FILE_ERRORS.includes(code)) setErrors((e) => ({ ...e, file: getErrorMessage(err) }));
      else setFormError(getErrorMessage(err));
      setSaving(false);
      setUploadPct(null);
    }
  };

  const planOptions = plans.map((p) => ({ value: p.id, label: p.name }));
  const currentInfo = course?.material ? MATERIAL_INFO[course.material.type] : null;

  return (
    <Modal
      open
      title={editing ? 'Edit course' : 'Add course'}
      description={editing
        ? `In ${course.planName}`
        : 'Upload a PDF, Word, PowerPoint or video file, or link to a web page.'}
      onClose={onClose}
      busy={saving}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="course-form" icon={editing ? 'check' : 'plus'} loading={saving}>
            {editing ? 'Save changes' : 'Add course'}
          </Button>
        </>
      )}
    >
      <form id="course-form" className="modal-form" onSubmit={handleSubmit} noValidate>
        {formError && <p className="inline-error" role="alert">{formError}</p>}

        <Input label="Course name" value={form.name} onChange={set('name')} error={errors.name}
          autoFocus maxLength={150} placeholder="e.g. Emergency Evacuation Procedures" />

        <div className="modal-form__row">
          {fixedPlan || editing ? (
            <Input label="Training plan" value={fixedPlan?.name || course.planName} disabled />
          ) : (
            <Select label="Training plan" value={form.planId} onChange={set('planId')}
              placeholder="Choose a plan" options={planOptions} error={errors.planId} />
          )}
          <Input label="Duration (minutes)" type="number" inputMode="numeric" min={1} max={10000}
            value={form.duration} onChange={set('duration')} error={errors.duration} hint="Optional" />
        </div>

        <fieldset className="choice-group">
          <legend className="field__label">Material</legend>
          <div className="choice-group__options">
            {modes.map((m) => (
              <label key={m.value} className={`choice ${form.mode === m.value ? 'is-on' : ''}`}>
                <input type="radio" name="material-mode" value={m.value} checked={form.mode === m.value}
                  onChange={set('mode')} disabled={saving} />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>

        {form.mode === 'keep' && currentInfo && (
          <p className="field__hint">
            Current material: <strong>{currentInfo.label}</strong>
            {course.material.url && <> · <a href={course.material.url} target="_blank" rel="noopener noreferrer">{course.material.url}</a></>}
          </p>
        )}

        {form.mode === 'file' && (
          <FileUpload accept={MATERIAL_EXTENSIONS} maxMb={MATERIAL_MAX_MB} file={file}
            onChange={(f) => { setFile(f); setErrors((e) => ({ ...e, file: undefined })); }}
            error={errors.file} disabled={saving}
            hint={hasMaterial ? 'The current material is replaced when you save.' : undefined} />
        )}

        {form.mode === 'link' && (
          <Input label="Web address" type="url" icon="link" value={form.link} onChange={set('link')}
            error={errors.link} placeholder="https://" maxLength={500} />
        )}

        {form.mode === 'none' && editing && (
          <p className="field__hint">The material is removed when you save. Trainees will see the course without it.</p>
        )}

        {uploadPct !== null && (
          <div className="upload-progress" aria-live="polite">
            <span>{uploadPct < 100 ? 'Uploading…' : 'Checking the file…'}</span>
            <ProgressBar value={uploadPct} tone="accent" label="Upload progress" />
          </div>
        )}
      </form>
    </Modal>
  );
}
