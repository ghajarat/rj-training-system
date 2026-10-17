// Edit a user's name, role and department (FR19). Email is read-only: it is
// the sign-in identity. Admins cannot change their own role (the backend
// enforces this too), so the role field is disabled for yourself.
import { useState } from 'react';
import { getErrorMessage } from '../../api/client';
import { updateUser } from '../../api/admin';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Select from '../../components/Select';
import { ROLE_OPTIONS } from './userOptions';

export default function EditUserModal({ user, isSelf, departments, onClose, onSaved }) {
  const [form, setForm] = useState({
    fullName: user.fullName,
    role: user.role,
    departmentId: user.departmentId || '',
  });
  const [nameError, setNameError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (field) => (event) => {
    setForm((f) => ({ ...f, [field]: event.target.value }));
    if (field === 'fullName') setNameError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);
    const fullName = form.fullName.trim();
    if (fullName.length < 2 || fullName.length > 100) {
      setNameError('Full name must be between 2 and 100 characters.');
      return;
    }

    // Send only what changed, so the audit log records real changes only.
    const changes = {};
    if (fullName !== user.fullName) changes.fullName = fullName;
    if (form.role !== user.role) changes.role = form.role;
    if ((form.departmentId || null) !== (user.departmentId || null)) changes.departmentId = form.departmentId || null;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const { user: saved } = await updateUser(user.id, changes);
      onSaved(saved);
    } catch (err) {
      setFormError(getErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Edit user"
      description={user.email}
      onClose={onClose}
      busy={saving}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="edit-user-form" loading={saving}>Save changes</Button>
        </>
      )}
    >
      <form id="edit-user-form" className="modal-form" onSubmit={handleSubmit} noValidate>
        {formError && <p className="inline-error" role="alert">{formError}</p>}
        <Input label="Full name" value={form.fullName} onChange={set('fullName')}
          error={nameError} autoFocus maxLength={100} />
        <Input label="Email" value={user.email} disabled
          hint="Email is the sign-in identity and cannot be changed." />
        <div className="modal-form__row">
          <Select label="Role" value={form.role} onChange={set('role')} options={ROLE_OPTIONS}
            disabled={isSelf} hint={isSelf ? 'You cannot change your own role.' : undefined} />
          <Select label="Department" value={form.departmentId} onChange={set('departmentId')}
            placeholder="No department"
            options={departments.map((d) => ({ value: d.id, label: d.name }))} />
        </div>
      </form>
    </Modal>
  );
}
