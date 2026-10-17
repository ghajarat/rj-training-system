// Invite a new user (FR1). On success the parent shows the one-time link,
// because there is no email service: the admin sends the link themselves.
import { useState } from 'react';
import { getErrorMessage } from '../../api/client';
import { inviteUser } from '../../api/admin';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Select from '../../components/Select';
import { EMAIL_RE, ROLE_OPTIONS } from './userOptions';

export default function InviteUserModal({ departments, onClose, onInvited }) {
  const [form, setForm] = useState({ fullName: '', email: '', role: 'Trainee', departmentId: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (field) => (event) => {
    setForm((f) => ({ ...f, [field]: event.target.value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const validate = () => {
    const next = {};
    const name = form.fullName.trim();
    if (name.length < 2) next.fullName = 'Enter the person’s full name.';
    else if (name.length > 100) next.fullName = 'Keep the name under 100 characters.';
    if (!EMAIL_RE.test(form.email.trim())) next.email = 'Enter a valid email address.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSaving(true);
    try {
      const result = await inviteUser({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        role: form.role,
        departmentId: form.departmentId || null,
      });
      onInvited(result);
    } catch (err) {
      const code = err.response?.data?.error?.code;
      if (code === 'EMAIL_TAKEN') setErrors((e) => ({ ...e, email: getErrorMessage(err) }));
      else setFormError(getErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Invite user"
      description="They will get a one-time link to set their own password."
      onClose={onClose}
      busy={saving}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="invite-user-form" icon="plus" loading={saving}>Create invitation</Button>
        </>
      )}
    >
      <form id="invite-user-form" className="modal-form" onSubmit={handleSubmit} noValidate>
        {formError && <p className="inline-error" role="alert">{formError}</p>}
        <Input label="Full name" value={form.fullName} onChange={set('fullName')}
          error={errors.fullName} autoComplete="off" autoFocus maxLength={100} />
        <Input label="Email" type="email" value={form.email} onChange={set('email')}
          error={errors.email} placeholder="name@rj.com" autoComplete="off" maxLength={255} />
        <div className="modal-form__row">
          <Select label="Role" value={form.role} onChange={set('role')} options={ROLE_OPTIONS} />
          <Select label="Department" value={form.departmentId} onChange={set('departmentId')}
            placeholder="No department"
            options={departments.map((d) => ({ value: d.id, label: d.name }))} />
        </div>
      </form>
    </Modal>
  );
}
