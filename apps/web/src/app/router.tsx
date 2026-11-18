import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { Loading } from '../components/ui/States';
import { ClinicPickerPage } from '../features/auth/ClinicPickerPage';
import { LoginPage } from '../features/auth/LoginPage';
import { SignupPage } from '../features/auth/SignupPage';
import { WaitingInvitePage } from '../features/auth/WaitingInvitePage';
import { ConsentPage } from '../features/consent/ConsentPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { PlatformAccountsPage, PlatformClinicPage, PlatformHomePage } from '../features/platform/PlatformPages';
import { PatientDetailPage } from '../features/patients/PatientDetailPage';
import { PatientsPage } from '../features/patients/PatientsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { useAuth } from '../lib/auth-store';
import { AppShell } from './AppShell';

// Telas pesadas (MediaPipe, three.js) carregam sob demanda.
const CaptureStartPage = lazy(() => import('../features/capture/CaptureStartPage').then((m) => ({ default: m.CaptureStartPage })));
const CaptureWizardPage = lazy(() => import('../features/capture/CaptureWizardPage').then((m) => ({ default: m.CaptureWizardPage })));
const ReconstructionPage = lazy(() => import('../features/capture/ReconstructionPage').then((m) => ({ default: m.ReconstructionPage })));
const SimulationsPage = lazy(() => import('../features/simulator/SimulationsPage').then((m) => ({ default: m.SimulationsPage })));
const SimulatorPage = lazy(() => import('../features/simulator/SimulatorPage').then((m) => ({ default: m.SimulatorPage })));

const suspend = (node: ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>;

function RequireAuth() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === 'unknown') return <Loading label="Abrindo sessão…" />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

/**
 * Telas do app exigem uma clínica ativa. Sem vínculo: "aguardando convite"; com vários e nenhuma
 * escolhida: tela de escolha.
 */
function RequireClinic() {
  const user = useAuth((s) => s.user);
  if (!user) return <Loading label="Abrindo sessão…" />;
  if (!user.clinicId) {
    if (user.clinics.length > 1) return <Navigate to="/clinicas" replace />;
    return <Navigate to={user.isPlatformAdmin ? '/plataforma' : '/aguardando'} replace />;
  }
  return <Outlet />;
}

/** Console da plataforma: só administrador da plataforma. */
function RequirePlatform() {
  const user = useAuth((s) => s.user);
  if (!user) return <Loading label="Abrindo sessão…" />;
  if (!user.isPlatformAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/cadastro', element: <SignupPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: 'clinicas', element: <ClinicPickerPage /> },
      {
        path: 'plataforma',
        element: <RequirePlatform />,
        children: [
          {
            element: <AppShell platform />,
            children: [
              { index: true, element: <PlatformHomePage /> },
              { path: 'clinicas/:id', element: <PlatformClinicPage /> },
              { path: 'contas', element: <PlatformAccountsPage /> },
            ],
          },
        ],
      },
      { path: 'aguardando', element: <WaitingInvitePage /> },
      {
        element: <RequireClinic />,
        children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'patients', element: <PatientsPage /> },
          { path: 'patients/:id', element: <PatientDetailPage /> },
          { path: 'patients/:id/consent', element: <ConsentPage /> },
          { path: 'capture', element: suspend(<CaptureStartPage />) },
          { path: 'capture/:captureId', element: suspend(<CaptureWizardPage />) },
          { path: 'reconstructions/:id', element: suspend(<ReconstructionPage />) },
          { path: 'simulations', element: suspend(<SimulationsPage />) },
          { path: 'simulations/:id', element: suspend(<SimulatorPage />) },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
        ],
      },
    ],
  },
]);
