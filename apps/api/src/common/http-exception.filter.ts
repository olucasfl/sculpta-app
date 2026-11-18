import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorBody } from '@sim/contracts';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

const DEFAULT_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
};

/** Toda resposta de erro sai no formato ApiErrorBody, sem vazar detalhes internos. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Erro');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) this.logger.error(exception);
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const r = exception.getResponse();
      const obj = typeof r === 'object' && r !== null ? (r as Record<string, unknown>) : {};
      const message =
        typeof obj.message === 'string'
          ? obj.message
          : typeof r === 'string'
            ? r
            : exception.message;
      return {
        statusCode: status,
        code: typeof obj.code === 'string' ? obj.code : (DEFAULT_CODE[status] ?? 'ERROR'),
        message: status === 429 ? 'Muitas tentativas. Aguarde um minuto.' : message,
        ...(Array.isArray(obj.details) ? { details: obj.details as ApiErrorBody['details'] } : {}),
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return { statusCode: 409, code: 'CONFLICT', message: 'Registro duplicado' };
      }
      if (exception.code === 'P2025') {
        return { statusCode: 404, code: 'NOT_FOUND', message: 'Não encontrado' };
      }
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      message: 'Erro interno',
    };
  }
}
