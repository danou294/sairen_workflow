import pino from 'pino';
import { config } from '../config';

const baseLogger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:dd/MM/yyyy HH:mm:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    service: 'sairen-workflow',
    env: config.NODE_ENV,
  },
});

/** Crée un logger enfant avec le nom du module */
export function createLogger(module: string) {
  return baseLogger.child({ module });
}

export default baseLogger;
