import winston from 'winston';

// Format avec correlation ID
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'artisants-api' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

export interface CorrelationLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  http(message: string, meta?: Record<string, unknown>): void;
}

export const createCorrelationLogger = (correlationId: string): CorrelationLogger => ({
  info: (message, meta) => logger.info(message, { correlationId, ...meta }),
  error: (message, meta) => logger.error(message, { correlationId, ...meta }),
  warn: (message, meta) => logger.warn(message, { correlationId, ...meta }),
  http: (message, meta) => logger.http(message, { correlationId, ...meta }),
});