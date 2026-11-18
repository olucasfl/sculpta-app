import { ROLE_LABEL } from '@sim/contracts';
import { Box, Camera, LayoutDashboard, LogOut, Menu, Settings, Users, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { logout } from '../lib/api';
import { useAuth } from '../lib/auth-store';
import { cn } from '../lib/format';

const NAV: { to: string; label: string; icon: ReactNode; soon?: string }[] = [
  { to: '/', label: 'Visão geral', icon: <LayoutDashboard className="size-4" aria-hidden /> },
  { to: '/patients', label: 'Pacientes', icon: <Users className="size-4" aria-hidden /> },
  { to: '/capture', label: 'Captura facial', icon: <Camera className="size-4" aria-hidden /> },
  { to: '/simulations', label: 'Simulações', icon: <Box className="size-4" aria-hidden /> },
  { to: '/settings', label: 'Configurações', icon: <Settings className="size-4" aria-hidden /> },
];

export function AppShell() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);

  const sidebar = (
    <nav aria-label="Principal" className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-white" aria-hidden>
          S
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">Simulador 3D</p>
          <p className="max-w-[10rem] truncate text-xs text-muted">{user?.clinicName}</p>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-subtle hover:text-ink',
                )
              }
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {item.soon && <span className="rounded bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-faint">{item.soon}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-line p-4">
        <p className="truncate text-sm font-medium">{user?.name}</p>
        <p className="text-xs text-muted">{user && ROLE_LABEL[user.role]}</p>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
          className="mt-3 inline-flex items-center gap-2 text-sm text-muted hover:text-ink"
        >
          <LogOut className="size-4" aria-hidden /> Sair
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Pular para o conteúdo
      </a>

      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface lg:block">{sidebar}</aside>

      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <span className="text-sm font-semibold">Simulador 3D</span>
        <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open} className="rounded-md p-2 hover:bg-subtle">
          <Menu className="size-5" aria-hidden />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface shadow-pop">
            <button type="button" onClick={() => setOpen(false)} aria-label="Fechar menu" className="absolute right-3 top-4 rounded-md p-1.5 hover:bg-subtle">
              <X className="size-4" aria-hidden />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <main id="conteudo" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
        <Outlet />
      </main>
    </div>
  );
}
