import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ChangePasswordRequest, CLINIC_HEADER, LoginRequest, SignupRequest } from '@sim/contracts';
import type { Request, Response } from 'express';
import { CurrentAccount, NoClinic, Public, requestIp, type AccountContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { AccountsService } from './accounts.service.js';
import { AuthService, type IssuedSession } from './auth.service.js';

export const REFRESH_COOKIE = 'sim_rt';
const COOKIE_PATH = '/api/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AccountsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  // 5 tentativas/min por IP (LOGIN_RATE_LIMIT ajusta, ex. nos testes).
  @Throttle({ default: { limit: () => Number(process.env.LOGIN_RATE_LIMIT ?? 5), ttl: 60_000 } })
  async login(
    @Body(new ZodPipe(LoginRequest)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(res, await this.auth.login(body, requestIp(req)));
  }

  /** Criar conta (já ativa; sem verificação de e-mail por enquanto). Entra direto, sem clínica, a menos que haja convite. */
  @Public()
  @Post('signup')
  @HttpCode(201)
  @Throttle({ default: { limit: () => Number(process.env.SIGNUP_RATE_LIMIT ?? 5), ttl: 60_000 } })
  async signup(
    @Body(new ZodPipe(SignupRequest)) body: SignupRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(res, await this.accounts.signup(body, requestIp(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: () => Number(process.env.REFRESH_RATE_LIMIT ?? 30), ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.send(res, await this.auth.refresh(this.cookie(req), this.clinic(req)));
    } catch (e) {
      this.clear(res);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.cookie(req));
    this.clear(res);
  }

  /** A conta e as clínicas em que ela tem vínculo ativo (não exige clínica escolhida). */
  @Get('me')
  @NoClinic()
  me(@CurrentAccount() me: AccountContext, @Req() req: Request) {
    return this.auth.me(me.userId, this.clinic(req));
  }

  /** Troca a senha e encerra as outras sessões (a atual continua). */
  @Post('change-password')
  @HttpCode(204)
  @NoClinic()
  async changePassword(
    @CurrentAccount() me: AccountContext,
    @Body(new ZodPipe(ChangePasswordRequest)) body: ChangePasswordRequest,
    @Req() req: Request,
  ) {
    await this.accounts.changePassword(me.userId, body, me.ip, await this.auth.familyOf(this.cookie(req)));
  }

  private clinic(req: Request): string | undefined {
    const v = req.headers[CLINIC_HEADER];
    const id = Array.isArray(v) ? v[0] : v;
    return id ? id.toLowerCase() : undefined;
  }

  private cookie(req: Request): string | undefined {
    const v = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
    return typeof v === 'string' ? v : undefined;
  }

  /** Refresh token só em cookie httpOnly; o access token fica na memória do front. */
  private send(res: Response, session: IssuedSession) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: session.refreshExpiresAt,
    });
    return session.response;
  }

  private clear(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }
}
