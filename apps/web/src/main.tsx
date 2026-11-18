import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app/router';
import { Toaster } from './components/ui/Toaster';
import { refreshSession } from './lib/api';
import { queryClient } from './lib/query-client';
import { applyStoredTheme } from './lib/theme';
import './index.css';

applyStoredTheme();

// PWA: só em produção (em dev o cache atrapalharia o recarregamento).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}

// A sessão sobrevive ao recarregar pela troca do cookie httpOnly por um access token.
void refreshSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
