import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Building2,
  CreditCard,
  Gauge,
  LayoutDashboard,
  Megaphone,
  Menu,
  PlusCircle,
  ScrollText,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Badge, Button, cn } from '@schoolerp/ui';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/schools', label: 'Schools', icon: Building2 },
  { to: '/schools/new', label: 'Onboard school', icon: PlusCircle, superAdminOnly: true },
  { to: '/billing', label: 'Billing', icon: CreditCard, billingOnly: true },
  { to: '/usage', label: 'Usage & metering', icon: Gauge, billingOnly: true },
  { to: '/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/audit', label: 'Platform audit', icon: ScrollText, superAdminOnly: true },
] as const;

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const items = useMemo(
    () =>
      NAV.filter((item) => {
        if ('superAdminOnly' in item && item.superAdminOnly && user?.role !== 'SUPER_ADMIN') {
          return false;
        }
        if (
          'billingOnly' in item &&
          item.billingOnly &&
          !(user?.role === 'SUPER_ADMIN' || user?.role === 'BILLING')
        ) {
          return false;
        }
        return true;
      }),
    [user?.role],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        navigate('/schools');
        requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>('#school-search')?.focus();
        });
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  function signOut() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Platform navigation"
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-white">
              SA
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Platform console</p>
              <p className="text-[11px] text-slate-500">SchoolERP control plane</p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="space-y-1 p-3">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : false}
                className={({ isActive }) => cn('nav-link', isActive && 'nav-link-active')}
                onClick={() => setMobileOpen(false)}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="absolute inset-x-0 bottom-0 border-t border-slate-100 p-4">
          <p className="text-xs text-slate-500">Signed in as</p>
          <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{user?.fullName}</p>
          <p className="truncate text-xs text-slate-500">{user?.email}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Badge tone={user?.role === 'SUPER_ADMIN' ? 'brand' : 'info'}>
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              {user?.role.replaceAll('_', ' ')}
            </Badge>
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <div>
              <p className="text-sm font-semibold text-slate-900">Platform administration</p>
              <p className="text-xs text-slate-500">
                Tenant lifecycle, announcements and control-plane audit
              </p>
            </div>
          </div>
          <span className="hidden text-xs text-slate-500 sm:block">
            Ctrl/⌘ K <span className="text-slate-400">school search</span>
          </span>
        </header>
        <main id="main" className="min-w-0 flex-1 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
