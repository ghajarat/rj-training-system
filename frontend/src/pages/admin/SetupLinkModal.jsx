// Shows a one-time invitation / password-reset link for the admin to copy
// (FR1). The link is shown only once: the server stores just its hash, so it
// cannot be displayed again later — the admin would issue a new one.
import { useRef, useState } from 'react';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { formatDateTime } from '../../utils/format';

export default function SetupLinkModal({ user, url, expiresAt, purpose, onClose }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);
  const isInvite = purpose === 'invite';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (e.g. non-HTTPS): select the text instead
      // so the admin can press Ctrl+C.
      inputRef.current?.select();
      return;
    }
    setCopied(true);
  };

  return (
    <Modal
      open
      title={isInvite ? 'Invitation link ready' : 'Password-reset link ready'}
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <p>
        Send this link to <strong>{user.fullName}</strong> ({user.email}). The system does not
        send email, so copy it into your usual channel.
      </p>
      <div className="link-box">
        <input ref={inputRef} className="field__input link-box__input" value={url} readOnly
          aria-label="Setup link" onFocus={(e) => e.target.select()} />
        <Button variant={copied ? 'secondary' : 'accent'} icon={copied ? 'check' : 'copy'} onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="field__hint">
        Works once and expires {formatDateTime(expiresAt)}.
        {isInvite
          ? ' Any earlier invitation link for this user no longer works.'
          : ' Their current password keeps working until they use the link.'}
        {' '}This link will not be shown again.
      </p>
    </Modal>
  );
}
