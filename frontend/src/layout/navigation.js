// Sidebar items per role. `path` must match a route in App.jsx; that route's
// ProtectedRoute decides who may open it, so keep the two in sync.
import { ROLES } from '../auth/roles';

const { TRAINEE, TRAINER, ADMIN } = ROLES;

export const NAV_SECTIONS = [
  {
    title: 'Workspace',
    items: [
      { label: 'My Dashboard',       path: '/dashboard',  icon: 'home',  roles: [TRAINEE] },
      { label: 'Trainer Overview',   path: '/trainer',    icon: 'home',  roles: [TRAINER] },
      { label: 'User Management',    path: '/admin/users', icon: 'users', roles: [ADMIN] },
      { label: 'Training Materials', path: '/materials',  icon: 'book',  roles: [TRAINEE, TRAINER] },
      { label: 'AI Assistant',       path: '/assistant',  icon: 'chat',  roles: [TRAINEE, TRAINER, ADMIN] },
      { label: 'Analytics & ROI',    path: '/analytics',  icon: 'chart', roles: [TRAINER, ADMIN] },
      { label: 'Reports',            path: '/reports',    icon: 'file',  roles: [TRAINER, ADMIN] },
    ],
  },
  {
    title: 'Support',
    items: [
      { label: 'Help & Resources', path: '/help',     icon: 'help',     roles: [TRAINEE, TRAINER, ADMIN] },
      { label: 'Settings',         path: '/settings', icon: 'settings', roles: [TRAINEE, TRAINER, ADMIN] },
    ],
  },
];

export function navFor(role) {
  return NAV_SECTIONS
    .map((section) => ({ ...section, items: section.items.filter((item) => item.roles.includes(role)) }))
    .filter((section) => section.items.length > 0);
}

// Page title for the top bar breadcrumb.
export function titleFor(pathname) {
  for (const section of NAV_SECTIONS) {
    const match = section.items.find((item) => pathname.startsWith(item.path));
    if (match) return { section: section.title, label: match.label };
  }
  return { section: 'Workspace', label: '' };
}
