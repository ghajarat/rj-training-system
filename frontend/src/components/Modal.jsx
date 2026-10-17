// Dialog window built on the native <dialog> element.
//
//   <Modal open={isOpen} title="Invite user" onClose={close}
//          footer={<Button onClick={save}>Save</Button>}>
//     ...form fields...
//   </Modal>
//
// showModal() gives us, for free: a backdrop, focus moved into the dialog
// and kept there, Esc to close, and the rest of the page made inert for
// screen readers. Clicking the backdrop also closes it.
import { useEffect, useId, useRef } from 'react';
import Icon from './Icon';
import './Modal.css';

export default function Modal({ open, title, description, onClose, footer, children, size = 'md', busy = false }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Esc fires "cancel". While a save is in flight, ignore it so the user
  // cannot close the window halfway through a request.
  const handleCancel = (event) => {
    event.preventDefault();
    if (!busy) onClose();
  };

  // A click whose target is the <dialog> itself landed on the backdrop.
  const handleClick = (event) => {
    if (event.target === ref.current && !busy) onClose();
  };

  return (
    <dialog
      ref={ref}
      className={`modal modal--${size}`}
      aria-labelledby={titleId}
      onCancel={handleCancel}
      onClick={handleClick}
    >
      {open && (
        <div className="modal__panel">
          <header className="modal__header">
            <div>
              <h2 id={titleId} className="modal__title">{title}</h2>
              {description && <p className="modal__description">{description}</p>}
            </div>
            <button type="button" className="modal__close" onClick={onClose} disabled={busy} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </header>
          <div className="modal__body">{children}</div>
          {footer && <footer className="modal__footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
