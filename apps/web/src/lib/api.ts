import type { ApiErrorBody, LoginRequest, LoginResponse } from '@sim/contracts';
import { useAuth } from './auth-store';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }

  /** Erros de validação por campo, no formato { campo: mensagem }. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.body.details ?? []).map((d) => [d.path, d.message]));
  }
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Devolve o corpo como Blob (imagens). */
  blob?: boolean;
}

const BASE = '/api';
const NO_RETRY = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);

function url(path: string, query?: Query) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return `${BASE}${path}${s ? `?${s}` : ''}`;
}

async function toError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = { statusCode: res.status, code: 'NETWORK', message: 'Resposta inesperada do servidor' };
  }
  return new ApiError(res.status, body);
}

async function send(path: string, opts: RequestOptions) {
  const token = useAuth.getState().accessToken;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    return await fetch(url(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, { statusCode: 0, code: 'NETWORK', message: 'Sem conexão com o servidor' });
  }
}

let refreshing: Promise<boolean> | null = null;

/**
 * Renova a sessão pelo cookie httpOnly. Chamadas simultâneas compartilham a mesma
 * renovação: o refresh token é de uso único, e duas renovações em paralelo
 * derrubariam a sessão por "reuso".
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await send('/auth/refresh', { method: 'POST' });
      if (!res.ok) {
        useAuth.getState().clear();
        return false;
      }
      const data = (await res.json()) as LoginResponse;
      useAuth.getState().setSession(data.accessToken, data.user);
      return true;
    } catch {
      useAuth.getState().clear();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(path, opts);
  if (res.status === 401 && !NO_RETRY.has(path) && (await refreshSession())) {
    res = await send(path, opts);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (opts.blob ? await res.blob() : await res.json()) as T;
}

export async function login(input: LoginRequest) {
  const data = await api<LoginResponse>('/auth/login', { method: 'POST', body: input });
  useAuth.getState().setSession(data.accessToken, data.user);
  return data;
}

export async function logout() {
  try {
    await api<void>('/auth/logout', { method: 'POST' });
  } finally {
    useAuth.getState().clear();
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Algo deu errado. Tente de novo.';
}
