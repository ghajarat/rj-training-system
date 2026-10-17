// Create a training plan, or edit its name, description and dates (FR8).
// Courses are added afterwards on the plan's page.
import { useState } from 'react';
import { getErrorMessage } from '../../api/client';
import { createPlan, updatePlan } from '../../api/training';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Textarea from '../../components/Textarea';
import { todayIso } from '../../utils/format';

export default function PlanFormModal({ plan, onClose, onSaved }) {
  const editing = Boolean(plan);
  const [form, setForm] = useState({
    name: plan?.name || '',
    description: plan?.description || '',
    startDate: plan?.startDate || todayIso(),
    dueDate: plan?.dueDate || '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (field) => (event) => {
    setForm((f) => ({ ...f, [field]: event.target.value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const validate = () => {
    const next = {};
    const name = form.name.trim();
    if (name.length < 3 || name.length > 150) next.name = 'Enter a plan name of 3 to 150 characters.';
    if (form.description.length > 2000) next.description = 'Keep the description under 2000 characters.';
    if (!form.startDate) next.startDate = 'Choose a start date.';
    if (!form.dueDate) next.dueDate = 'Choose a due date.';
    else if (form.startDate && form.dueDate < form.startDate) next.dueDate = 'The due date cannot be before the start date.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSaving(true);
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      startDate: form.startDate,
      dueDate: form.dueDate,
    };
    try {
      const result = editing ? await updatePlan(plan.id, body) : await createPlan(body);
      onSaved(result.plan);
    } catch (err) {
      setFormError(getErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={editing ? 'Edit plan details' : 'New training plan'}
      description={editing ? undefined : 'After creating the plan you can add its courses and assign trainees.'}
      onClose={onClose}
      busy={saving}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="plan-form" icon={editing ? 'check' : 'plus'} loading={saving}>
            {editing ? 'Save changes' : 'Create plan'}
          </Button>
        </>
      )}
    >
      <form id="plan-form" className="modal-form" onSubmit={handleSubmit} noValidate>
        {formError && <p className="inline-error" role="alert">{formError}</p>}
        <Input label="Plan name" value={form.name} onChange={set('name')} error={errors.name}
          autoFocus maxLength={150} placeholder="e.g. Cabin Safety Recurrent 2027" />
        <Textarea label="Description" value={form.description} onChange={set('description')}
          error={errors.description} hint="Optional" maxLength={2000} />
        <div className="modal-form__row">
          <Input label="Start date" type="date" value={form.startDate} onChange={set('startDate')} error={errors.startDate} />
          <Input label="Due date" type="date" value={form.dueDate} onChange={set('dueDate')}
            min={form.startDate || undefined} error={errors.dueDate} />
        </div>
      </form>
    </Modal>
  );
}
