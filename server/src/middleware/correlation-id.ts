import { Request, Response, NextFunction } from 'express';
import { createCorrelationLogger } from '../lib/logger';

export const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const headerValue = req.headers['x-correlation-id'];
  const correlationId =
    typeof headerValue === 'string'
      ? headerValue
      : Array.isArray(headerValue)
        ? headerValue[0]
        : crypto.randomUUID();

  (req as Request & { correlationId?: string }).correlationId = correlationId;
  (req as Request & { logger?: ReturnType<typeof createCorrelationLogger> }).logger =
    createCorrelationLogger(correlationId);

  res.setHeader('x-correlation-id', correlationId);
  next();
};