import { ROLE_LABEL } from '@sim/contracts';
import { ArrowLeftRight, Box, Building2, Camera, LayoutDashboard, LogOut, Menu, Monitor, Moon, MoreHorizontal, Settings, Shield, Sun, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Logo, LogoSymbol } from '../components/Logo';
import { WelcomeDialog } from '../features/auth/WelcomeDialog';
import { Sheet } from '../components/ui/Sheet';
import { api, logout } from '../lib/api';
import { useAuth } from '../lib/auth-store';
import { cn } from '../lib/format';
import { leaveSupport } from '../lib/query-client';
import { THEME_LABEL, useTheme } from '../lib/theme';
import { useClinicLogo } from '../lib/use-clinic-logo';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Aparece na barra inferior do celular (os demais vão para "Mais"). */
  primary: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Visão geral', icon: <LayoutDashboard className="size-5 shrink-0" aria-hidden />, primary: true },
  { to: '/patients', label: 'Pacientes', icon: <Users className="size-5 shrink-0" aria-hidden />, primary: true },
  { to: '/capture', label: 'Captura', icon: <Camera className="size-5 shrink-0" aria-hidden />, primary: true },
  { to: '/simulations', label: 'Simulações', icon: <Box className="size-5 shrink-0" aria-hidden />, primary: true },
  { to: '/settings', label: 'Configurações', icon: <Settings className="size-5 shrink-0" aria-hidden />, primary: false },
];

const PLATFORM_NAV: NavItem[] = [
  { to: '/plataforma', label: 'Clínicas', icon: <Building2 className="size-5 shrink-0" aria-hidden />, primary: true },
  { to: '/plataforma/contas', label: 'Contas', icon: <Users className="size-5 shrink-0" aria-hidden />, primary: true },
];

/** `platform`: navegação do console do administrador da plataforma (sem itens de clínica). */
export function AppShell({ platform = false }: { platform?: boolean }) {
  const user = useAuth((s) => s.user);
  const nav: NavItem[] = platform
    ? PLATFORM_NAV
    : user?.isPlatformAdmin
      ? [...NAV, { to: '/plataforma', label: 'Plataforma', icon: <Shield className="size-5 shrink-0" aria-hidden />, primary: false }]
      : NAV;
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const clinicInfo = useQuery({
    queryKey: ['clinic'],
    queryFn: () => api<{ hasLogo: boolean }>('/clinic'),
    enabled: !platform && !!user?.clinicId,
  });
  const logo = useClinicLogo(clinicInfo.data?.hasLogo ?? false);
  const [drawer, setDrawer] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    setDrawer(false);
    setMore(false);
  }, [location.pathname]);

  const doLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const ThemeIcon = theme.choice === 'dark' ? Moon : theme.choice === 'light' ? Sun : Monitor;
  const themeButton = (withLabel: boolean) => (
    <button
      type="button"
      onClick={theme.cycle}
      title={THEME_LABEL[theme.choice]}
      aria-label={THEME_LABEL[theme.choice]}
      className={cn(
        'inline-flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-muted hover:bg-subtle hover:text-ink',
        !withLabel && 'justify-center px-0',
      )}
    >
      <ThemeIcon className="size-5 shrink-0" aria-hidden />
      {withLabel && <span>{THEME_LABEL[theme.choice]}</span>}
    </button>
  );

  const navLinks = (labels: 'always' | 'xl') => (
    <ul className="flex-1 space-y-1 px-3">
      {nav.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.to === '/' || item.to === '/plataforma'}
            title={item.label}
            className={({ isActive }) =>
              cn(
                'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                labels === 'xl' && 'max-xl:justify-center max-xl:px-0',
                isActive ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-subtle hover:text-ink',
              )
            }
          >
            {item.icon}
            <span className={cn(labels === 'xl' && 'max-xl:sr-only')}>{item.label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  );

  const userBlock = (compact: boolean) => (
    <div className={cn('border-t border-line p-3', compact && 'max-xl:flex max-xl:flex-col max-xl:items-center max-xl:gap-1')}>
      <div className={cn('px-3 pb-2', compact && 'max-xl:sr-only')}>
        <p className="truncate text-sm font-medium">{user?.name}</p>
        <p className="text-xs text-muted">{user?.role && ROLE_LABEL[user.role]}</p>
      </div>
      <div className={cn(compact && 'max-xl:w-full')}>{themeButton(!compact)}</div>
      <button
        type="button"
        onClick={doLogout}
        title="Sair"
        className={cn(
          'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted hover:bg-subtle hover:text-ink',
          compact && 'max-xl:justify-center max-xl:px-0',
        )}
      >
        <LogOut className="size-5 shrink-0" aria-hidden />
        <span className={cn(compact && 'max-xl:sr-only')}>Sair</span>
      </button>
    </div>
  );

  /** Só aparece para quem tem vínculo em mais de uma clínica. */
  const switchLink =
    (user?.clinics.length ?? 0) > 1 ? (
      <NavLink to="/clinicas" className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-accent hover:underline">
        <ArrowLeftRight className="size-4" aria-hidden /> Trocar de clínica
      </NavLink>
    ) : null;

  const brand = (
    <div className="flex h-16 items-center px-5 max-xl:justify-center max-xl:px-0">
      <Logo className="h-8 max-xl:hidden" />
      <LogoSymbol className="hidden size-8 max-xl:block" />
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[4.5rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Pular para o conteúdo
      </a>

      {/* ≥1024: sidebar fixa (recolhida até 1279, expandida a partir de 1280) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <nav aria-label="Principal" className="flex h-full flex-col">
          {brand}
          <div className="px-5 pb-2 text-xs text-muted max-xl:hidden">
            <p className="flex items-center gap-2 truncate">
              {logo && <img src={logo} alt="" className="size-6 shrink-0 rounded object-contain" />}
              <span className="truncate">{user?.clinicName}</span>
            </p>
            {switchLink}
          </div>
          {navLinks('xl')}
          {userBlock(true)}
        </nav>
      </aside>

      {/* <1024: barra superior (com menu em tablet) */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface px-4 pt-safe lg:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <Logo className="h-7" />
          <span className="hidden truncate text-sm text-muted sm:inline">{user?.clinicName}</span>
        </div>
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-label="Abrir menu"
          className="hidden size-11 items-center justify-center rounded-md text-ink hover:bg-subtle md:inline-flex"
        >
          <Menu className="size-5" aria-hidden />
        </button>
      </header>

      <Sheet open={drawer} onClose={() => setDrawer(false)} label="Menu" side="left">
        <nav aria-label="Principal" className="flex h-full min-h-dvh flex-col">
          <div className="flex h-16 items-center px-5">
            <Logo className="h-8" />
          </div>
          <div className="px-5 pb-2 text-xs text-muted">
            <p className="truncate">{user?.clinicName}</p>
            {switchLink}
          </div>
          {navLinks('always')}
          {userBlock(false)}
        </nav>
      </Sheet>

      <WelcomeDialog />

      <main
        id="conteudo"
        className="mx-auto w-full max-w-[80rem] px-4 pb-28 pt-6 md:px-6 md:pb-10 lg:pt-8 xl:px-8"
      >
        {user?.support && (
          <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
            <span>
              <strong>Modo suporte</strong> em {user.clinicName}: somente leitura, sem fotos nem modelos 3D. Vale até{' '}
              {new Date(user.support.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
            </span>
            <button
              type="button"
              className="min-h-11 font-medium underline"
              onClick={async () => {
                await leaveSupport();
                navigate('/plataforma', { replace: true });
              }}
            >
              Encerrar suporte
            </button>
          </div>
        )}
        <Outlet />
      </main>

      {/* <768: navegação inferior, ao alcance do polegar */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-safe md:hidden"
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${nav.filter((n) => n.primary).length + (nav.some((n) => !n.primary) ? 1 : 0)}, minmax(0, 1fr))` }}>
          {nav.filter((n) => n.primary).map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/' || item.to === '/plataforma'}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium',
                    isActive ? 'text-accent' : 'text-muted',
                  )
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            </li>
          ))}
          {nav.some((n) => !n.primary) && (
          <li>
            <button
              type="button"
              onClick={() => setMore(true)}
              aria-haspopup="dialog"
              className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted"
            >
              <MoreHorizontal className="size-5" aria-hidden />
              Mais
            </button>
          </li>
          )}
        </ul>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} label="Mais opções" side="bottom">
        <div className="p-4 pt-5">
          <div className="mb-3 pr-12">
            <p className="font-medium">{user?.name}</p>
            <p className="text-sm text-muted">
              {user?.role && ROLE_LABEL[user.role]} · {user?.clinicName}
            </p>
          </div>
          <ul className="space-y-1">
            {nav
              .filter((n) => !n.primary)
              .map((n) => (
                <li key={n.to}>
                  <NavLink to={n.to} className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-base font-medium hover:bg-subtle">
                    {n.icon} {n.label}
                  </NavLink>
                </li>
              ))}
            {switchLink && <li>{switchLink}</li>}
            <li>{themeButton(true)}</li>
            <li>
              <button
                type="button"
                onClick={doLogout}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-base text-muted hover:bg-subtle hover:text-ink"
              >
                <LogOut className="size-5" aria-hidden /> Sair
              </button>
            </li>
          </ul>
        </div>
      </Sheet>
    </div>
  );
}
