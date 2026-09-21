/**
 * Minimal structured logging.
 *
 * V0 logs enough to diagnose application errors without adding heavyweight
 * observability (04_TECHNICAL_ARCHITECTURE.md §16). Never log tokens, session
 * objects or partner evidence.
 */
import { env } from './env';

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const entry = {
    level,
    message,
    env: env.appEnv,
    at: new Date().toISOString(),
    ...(context ?? {}),
  };
  // eslint-disable-next-line no-console
  console[level](JSON.stringify(entry));
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
