import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const FRONTEND_GUARDED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ORIGIN_GUARD_BYPASS_PATHS = new Set(['/checkout/webhook', '/tracking/wiio']);
type RequestOriginGuardRequest = {
  method?: string;
  path?: string;
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
};
type NextFunction = (error?: unknown) => void;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);
  const allowedOrigins = getAllowedOrigins(configService);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        callback(null, configService.get<string>('NODE_ENV') !== 'production');
        return;
      }

      const isConfiguredOrigin = allowedOrigins.includes(origin);
      const isLocalViteOrigin =
        configService.get<string>('NODE_ENV') !== 'production' &&
        /^http:\/\/(localhost|127\.0\.0\.1):517\d$/.test(origin);

      callback(null, Boolean(isConfiguredOrigin || isLocalViteOrigin));
    },
  });

  app.use((
    request: RequestOriginGuardRequest,
    _response: unknown,
    next: NextFunction,
  ) => {
    if (!shouldValidateFrontendOrigin(request)) {
      next();
      return;
    }

    const requestOrigin = getRequestOrigin(request);
    const isAllowedOrigin = requestOrigin
      ? allowedOrigins.includes(requestOrigin) ||
        (configService.get<string>('NODE_ENV') !== 'production' &&
          /^http:\/\/(localhost|127\.0\.0\.1):517\d$/.test(requestOrigin))
      : false;

    if (!isAllowedOrigin) {
      next(new ForbiddenException('Request origin is not allowed.'));
      return;
    }

    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: {
        target: false,
        value: false,
      },
    }),
  );

  await app.listen(configService.get<number>('PORT', 3000));
}

function getAllowedOrigins(configService: ConfigService): string[] {
  const configuredOrigins = [
    configService.get<string>('FRONTEND_ALLOWED_ORIGINS'),
    configService.get<string>('FRONTEND_ORIGIN'),
    configService.get<string>('FRONTEND_URL'),
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map(normalizeOrigin)
    .filter(Boolean);

  return [...new Set(configuredOrigins)];
}

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value.trim());
    return url.origin;
  } catch {
    return '';
  }
}

function shouldValidateFrontendOrigin(request: {
  method?: string;
  path?: string;
  originalUrl?: string;
}): boolean {
  const method = request.method?.toUpperCase() ?? '';
  const path = request.path || request.originalUrl?.split('?')[0] || '';

  return (
    FRONTEND_GUARDED_METHODS.has(method) &&
    !ORIGIN_GUARD_BYPASS_PATHS.has(path)
  );
}

function getRequestOrigin(request: {
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const origin = getFirstHeaderValue(request.headers?.origin);
  if (origin) return normalizeOrigin(origin);

  const referer = getFirstHeaderValue(request.headers?.referer);
  return referer ? normalizeOrigin(referer) : '';
}

function getFirstHeaderValue(value?: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

void bootstrap();
