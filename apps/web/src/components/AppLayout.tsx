import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BedDouble,
  Bus,
  CalendarCheck,
  CalendarClock,
  ChartBar,
  ClipboardList,
  FileQuestion,
  GraduationCap,
  LayoutDashboard,
  Library,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Package,
  Receipt,
  Search,
  Settings,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { Badge, Button, cn } from '@schoolerp/ui';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/format';

interface NavItem {
  to: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  permission?: string;
  portal?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'dashboard', icon: LayoutDashboard, permission: 'dashboard:view' },
  { to: '/students', labelKey: 'students', icon: Users, permission: 'students:read' },
  { to: '/admissions', labelKey: 'admissions', icon: UserPlus, permission: 'admissions:read' },
  { to: '/attendance', labelKey: 'attendance', icon: CalendarCheck, permission: 'attendance:read' },
  { to: '/timetable', labelKey: 'timetable', icon: CalendarClock, permission: 'timetable:read' },
  { to: '/question-bank', labelKey: 'questionBank', icon: FileQuestion, permission: 'exams:read' },
  { to: '/homework', labelKey: 'homework', icon: ClipboardList, permission: 'homework:read' },
  { to: '/fees', labelKey: 'fees', icon: Wallet, permission: 'fees:read' },
  { to: '/hr', labelKey: 'hr', icon: GraduationCap, permission: 'staff:read' },
  { to: '/payroll', labelKey: 'payroll', icon: Receipt, permission: 'payroll:read' },
  { to: '/library', labelKey: 'library', icon: Library, permission: 'library:read' },
  { to: '/transport', labelKey: 'transport', icon: Bus, permission: 'transport:read' },
  { to: '/hostel', labelKey: 'hostel', icon: BedDouble, permission: 'hostel:read' },
  { to: '/inventory', labelKey: 'inventory', icon: Package, permission: 'inventory:read' },
  { to: '/messages', labelKey: 'messages', icon: MessageSquare, permission: 'messages:read' },
  { to: '/reports', labelKey: 'reports', icon: ChartBar, permission: 'analytics:read' },
  {
    to: '/notices',
    labelKey: 'notices',
    icon: Megaphone,
    permission: 'communication:read',
  },
  { to: '/settings', labelKey: 'settings', icon: Settings },
];

export function AppLayout() {
  const { user, logout, hasPermission } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const items = useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
        if (!item.permission) return true;
        if (item.permission === 'communication:read') {
          return hasPermission('communication:read') || hasPermission('portal:read');
        }
        return hasPermission(item.permission);
      }),
    [hasPermission],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (!user) return null;

  const roleLabel = user.roleCode
    .toLowerCase()
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  function changeLanguage(language: string) {
    void i18n.changeLanguage(language);
    localStorage.setItem('erp.locale', language);
  }

  return (
    <div className="app-shell">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow"
      >
        Skip to content
      </a>

      <div className="flex min-h-screen">
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          aria-label="Primary navigation"
        >
          <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
            <NavLink to="/" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
                E
              </span>
              <span className="text-base font-semibold tracking-tight text-slate-900">
                {t('appName')}
              </span>
            </NavLink>
            <button
              type="button"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => cn('nav-link', isActive && 'nav-link-active')}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t(item.labelKey)}
                </NavLink>
              );
            })}
          </nav>

          <div className="border-t border-slate-100 p-3">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Signed in as
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-900">{user.fullName}</p>
              <p className="truncate text-xs text-slate-500">{roleLabel}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full justify-start"
                onClick={() => void handleLogout()}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {t('signOut')}
              </Button>
            </div>
          </div>
        </aside>

        {mobileOpen ? (
          <button
            type="button"
            aria-label="Close navigation overlay"
            className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
            <button
              type="button"
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{user.schoolName}</p>
              <p className="truncate text-xs text-slate-500">Tenant · {user.schoolSlug}</p>
            </div>

            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 hover:border-slate-300 sm:flex"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              <span>{t('search')}</span>
              <kbd className="rounded border border-slate-300 bg-white px-1.5 text-[10px] font-medium text-slate-500">
                Ctrl K
              </kbd>
            </button>

            <label className="sr-only" htmlFor="language-select">
              Language
            </label>
            <select
              id="language-select"
              value={i18n.language}
              onChange={(event) => changeLanguage(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
            >
              <option value="en">EN</option>
              <option value="ne">ने</option>
              <option value="ar">العربية</option>
            </select>

            <span
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700"
              title={user.fullName}
            >
              {initials(user.fullName)}
            </span>
          </header>

          <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={items} />
    </div>
  );
}

function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const filtered = items.filter((item) =>
    t(item.labelKey).toLowerCase().includes(query.trim().toLowerCase()),
  );

  if (!open) return null;

  function go(item: NavItem | undefined) {
    if (!item) return;
    navigate(item.to);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-24">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-4">
          <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, filtered.length - 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              }
              if (event.key === 'Enter') go(filtered[active]);
            }}
            placeholder="Search pages and actions…"
            className="h-12 flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            aria-label="Search pages"
          />
          <Badge tone="neutral">Esc</Badge>
        </div>
        <ul role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-slate-500">No matches</li>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon;
              return (
                <li key={item.to} role="option" aria-selected={index === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(item)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                      index === active
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {t(item.labelKey)}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
