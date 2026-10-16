import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import * as dotenv from 'dotenv';

import artisanRoutes from './api/artisan.routes';
import quoteRoutes from './api/quote.routes';
import webhookRoutes from './api/webhook.routes';
import { errorHandler } from './middleware/error-handler';
import { correlationIdMiddleware } from './middleware/correlation-id';
import { logger } from './lib/logger';
import { setupSwagger } from './lib/swagger';

dotenv.config();

// ============================================
// 1. Validation des variables d'environnement au démarrage
// ============================================
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_WEBHOOK_SECRET',
];

const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingEnvVars.length > 0) {
  logger.error(`Variables d'environnement manquantes : ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ============================================
// 2. Initialisation Express
// ============================================
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const API_VERSION = '/api/v1';

// ============================================
// 3. Middlewares de sécurité et logging
// ============================================
app.use(helmet());
app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));

// CORS restreint aux domaines de l'application mobile
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-secret'],
  })
);

app.use(express.json());

// Correlation ID middleware
app.use(correlationIdMiddleware);

// ============================================
// 4. Rate limiting
// ============================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requêtes par fenêtre
  message: { error: 'Trop de tentatives, veuillez réessayer plus tard' },
  standardHeaders: true,
  legacyHeaders: false,
});

const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requêtes par fenêtre
  message: { error: 'Trop de demandes de devis, veuillez réessayer plus tard' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requêtes par fenêtre
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);

// ============================================
// 5. Routes versionnées (/api/v1/...)
// ============================================
app.use(`${API_VERSION}/artisans`, authLimiter, artisanRoutes);
app.use(`${API_VERSION}/quotes`, quoteLimiter, quoteRoutes);
app.use(`${API_VERSION}/webhooks`, webhookRoutes);

// Health check endpoint
app.get(`${API_VERSION}/health`, (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

app.get('/', (_req, res) => {
  res.json({ message: 'Bienvenue sur l\'API ARTISANTS 🚀', status: 'OK', apiVersion: API_VERSION });
});

// Swagger documentation
setupSwagger(app);

// ============================================
// 6. Gestionnaire d'erreurs global
// ============================================
app.use(errorHandler);

// ============================================
// 7. Lancement du serveur avec arrêt graceful
// ============================================
const server = app.listen(PORT, () => {
  logger.info(`Serveur démarré sur http://localhost:${PORT}${API_VERSION}`);
});

const gracefulShutdown = (signal: string) => {
  logger.info(`Signal ${signal} reçu, arrêt du serveur...`);
  server.close(() => {
    logger.info('Serveur fermé.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Gestion des erreurs non capturées
process.on('uncaughtException', (err: Error) => {
  logger.error('Exception non capturée:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Promesse rejetée non gérée:', reason);
  process.exit(1);
});
