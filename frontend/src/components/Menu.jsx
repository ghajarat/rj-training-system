// Small dropdown of actions opened from an icon button (the gear on each
// User Management row).
//
//   <Menu label="Actions for Omar" icon="settings" items={[
//     { label: 'Edit', icon: 'edit', onSelect: edit },
//     { label: 'Deactivate', icon: 'userOff', onSelect: deactivate, tone: 'danger' },
//   ]} />
//
// The list is position: fixed, placed under the button, so it is not clipped
// by a scrolling table. It closes on outside click, Esc, scroll or resize.
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import './Menu.css';

export default function Menu({ label, icon = 'settings', items }) {
  const [position, setPosition] = useState(null); // null = closed
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const open = position !== null;

  const close = () => setPosition(null);

  const toggle = () => {
    if (open) return close();
    const rect = buttonRef.current.getBoundingClientRect();
    // Open upwards when there is not enough room below the button.
    const below = window.innerHeight - rect.bottom > 48 * items.length + 16;
    setPosition({
      right: window.innerWidth - rect.right,
      ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }),
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    listRef.current?.querySelector('button')?.focus();

    const onPointerDown = (event) => {
      if (!listRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="menu__trigger"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name={icon} size={16} />
      </button>
      {open && (
        <ul ref={listRef} className="menu__list" role="menu" style={position}>
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={`menu__item ${item.tone === 'danger' ? 'menu__item--danger' : ''}`}
                onClick={() => { close(); item.onSelect(); }}
              >
                {item.icon && <Icon name={item.icon} size={15} />}
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
