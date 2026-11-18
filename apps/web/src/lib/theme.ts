import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'sculpta.theme';

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/** Chamar antes de renderizar, para não piscar o tema errado. */
export const applyStoredTheme = () => apply(read());

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  useEffect(() => apply(choice), [choice]);
  const cycle = useCallback(() => {
    setChoice((cur) => {
      const next: ThemeChoice = cur === 'system' ? 'light' : cur === 'light' ? 'dark' : 'system';
      try {
        if (next === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, next);
      } catch {
        /* sem armazenamento: vale só nesta sessão */
      }
      return next;
    });
  }, []);
  return { choice, cycle };
}

export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: 'Tema: automático',
  light: 'Tema: claro',
  dark: 'Tema: escuro',
};
