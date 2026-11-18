import type { AuthUser } from '@sim/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, refreshSession } from './api';
import { useAuth } from './auth-store';

const user: AuthUser = {
  id: 'u1',
  name: 'Ana',
  email: 'a@x.test',
  isPlatformAdmin: false,
  clinics: [{ id: 'c1', name: 'C', role: 'OWNER' }],
  role: 'OWNER',
  clinicId: 'c1',
  clinicName: 'C',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  useAuth.setState({ status: 'unknown', accessToken: null, user: null });
});

describe('api client', () => {
  it('envia o token e, no 401, renova a sessão uma vez e repete a chamada', async () => {
    useAuth.getState().setSession('velho', user);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const authz = (init?.headers as Record<string, string>)?.Authorization;
      if (path === '/api/auth/refresh') return json(200, { accessToken: 'novo', expiresIn: 900, user });
      return authz === 'Bearer novo' ? json(200, { ok: true }) : json(401, { statusCode: 401, code: 'TOKEN_EXPIRED', message: 'x' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/patients')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(['/api/patients', '/api/auth/refresh', '/api/patients']);
    expect(useAuth.getState().accessToken).toBe('novo');
  });

  it('chamadas simultâneas compartilham uma única renovação', async () => {
    let refreshes = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/refresh') {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { accessToken: 't', expiresIn: 900, user });
      }
      return json(200, {});
    }));
    await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(refreshes).toBe(1);
  });

  it('refresh recusado encerra a sessão e o erro chega com campos', async () => {
    useAuth.getState().setSession('velho', user);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/auth/refresh'
        ? json(401, { statusCode: 401, code: 'UNAUTHORIZED', message: 'Sessão expirada' })
        : json(401, { statusCode: 401, code: 'TOKEN_EXPIRED', message: 'Sessão expirada' }),
    ));
    const err = await api('/patients').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(useAuth.getState().status).toBe('anonymous');

    const v = new ApiError(400, { statusCode: 400, code: 'VALIDATION_ERROR', message: 'x', details: [{ path: 'name', message: 'curto' }] });
    expect(v.fieldErrors()).toEqual({ name: 'curto' });
  });
});
