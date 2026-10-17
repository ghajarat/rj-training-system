// Shared layout for every signed-in page: 240px sidebar + top bar + content.
// Pages render into <Outlet />.
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import BrandMark from '../components/BrandMark';
import Icon from '../components/Icon';
import { initials } from '../utils/format';
import { navFor, titleFor } from './navigation';
import './AppShell.css';

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The mobile drawer remembers which page it was opened on, so it closes
  // by itself as soon as the user navigates somewhere else.
  const [menuOpenOn, setMenuOpenOn] = useState(null);
  const menuOpen = menuOpenOn === pathname;
  const setMenuOpen = (open) => setMenuOpenOn(open ? pathname : null);

  const sections = navFor(user.role);
  const crumb = titleFor(pathname);

  const handleLogout = () => {
    logout();
    navigate('/signin', { replace: true });
  };

  return (
    <div className={`shell ${menuOpen ? 'shell--menu-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar__brand">
          <BrandMark tone="light" />
        </div>

        <nav className="sidebar__nav">
          {sections.map((section) => (
            <div key={section.title} className="sidebar__section">
              <p className="sidebar__section-title">{section.title}</p>
              <ul>
                {section.items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      className={({ isActive }) => `sidebar__link ${isActive ? 'is-active' : ''}`}
                    >
                      <Icon name={item.icon} size={16} />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sidebar__user">
          <span className="avatar avatar--sidebar">{initials(user.fullName)}</span>
          <span className="sidebar__user-text">
            <span className="sidebar__user-name">{user.fullName}</span>
            <span className="sidebar__user-meta">{user.department || user.role}</span>
          </span>
          <button type="button" className="sidebar__logout" onClick={handleLogout} aria-label="Sign out" title="Sign out">
            <Icon name="logout" size={16} />
          </button>
        </div>
      </aside>

      <div className="shell__backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />

      <div className="shell__main">
        <header className="topbar">
          <button
            type="button"
            className="topbar__menu"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Open navigation"
            aria-expanded={menuOpen}
          >
            <Icon name="menu" size={18} />
          </button>

          <nav className="topbar__crumb" aria-label="Breadcrumb">
            <span>{crumb.section}</span>
            {crumb.label && <><span className="topbar__crumb-sep">›</span><strong>{crumb.label}</strong></>}
          </nav>

          <label className="topbar__search">
            <Icon name="search" size={15} />
            <span className="sr-only">Search</span>
            <input type="search" placeholder="Search courses, documents, people…" disabled />
          </label>

          <div className="topbar__actions">
            <button type="button" className="topbar__icon-btn" aria-label="Notifications">
              <Icon name="bell" size={17} />
            </button>
            <div className="topbar__user">
              <span className="avatar">{initials(user.fullName)}</span>
              <span className="topbar__user-text">
                <span className="topbar__user-name">{user.fullName}</span>
                <span className="topbar__user-role">{user.role}</span>
              </span>
            </div>
          </div>
        </header>

        <main className="shell__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
