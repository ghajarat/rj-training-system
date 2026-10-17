// "Are you sure?" dialog for actions that need a second click.
//
//   <ConfirmDialog open title="Deactivate Omar?" confirmLabel="Deactivate"
//                  tone="danger" busy={saving} error={error}
//                  onConfirm={doIt} onCancel={close}>
//     They will be signed out immediately.
//   </ConfirmDialog>
import Button from './Button';
import Modal from './Modal';

export default function ConfirmDialog({
  open, title, children, confirmLabel = 'Confirm', tone = 'primary',
  busy = false, error, onConfirm, onCancel,
}) {
  return (
    <Modal
      open={open}
      size="sm"
      title={title}
      onClose={onCancel}
      busy={busy}
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </>
      )}
    >
      <div>{children}</div>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </Modal>
  );
}
