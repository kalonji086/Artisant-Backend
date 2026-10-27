import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import * as dotenv from 'dotenv';

import artisanRoutes from './api/artisan.routes';
import quoteRoutes from './api/quote.routes';
import adminRoutes from './api/admin.routes';
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
];

const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingEnvVars.length > 0) {
  logger.error(`Variables d'environnement manquantes : ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// SUPABASE_WEBHOOK_SECRET est optionnel : si absent, le webhook n'est pas protégé
if (!process.env.SUPABASE_WEBHOOK_SECRET) {
  logger.warn('Attention: SUPABASE_WEBHOOK_SECRET non defini - le webhook Supabase ne sera pas protege');
}

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ============================================
// 2. Initialisation Express
// ============================================
const app = express();
app.set('trust proxy', 1); // Render/proxy : IP client réelle via X-Forwarded-For (sinon quota rate-limit partagé → 429)
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
  max: 2000, // 2000 requêtes par fenêtre (listes publiques mobile + IP partagées Render)
  message: { error: 'Trop de tentatives, veuillez réessayer plus tard' },
  standardHeaders: true,
  legacyHeaders: false,
});

const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requêtes par fenêtre
  message: { error: 'Trop de demandes de devis, veuillez réessayer plus tard' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requêtes par fenêtre (compatible IP partagées Render/proxy + dev mobile)
  standardHeaders: true,
  legacyHeaders: false,
  // Exclure le health check du comptage (surveillance Render)
  skip: (req) => req.path === `${API_VERSION}/health`,
});

// Health check exclu du rate limiting (surveillance Render)
app.get(`${API_VERSION}/health`, (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

app.use(generalLimiter);

// ============================================
// 5. Routes versionnées (/api/v1/...)
// ============================================
app.use(`${API_VERSION}/artisans`, authLimiter, artisanRoutes);
app.use(`${API_VERSION}/quotes`, quoteLimiter, quoteRoutes);
app.use(`${API_VERSION}/admin`, adminRoutes);
app.use(`${API_VERSION}/webhooks`, webhookRoutes);

app.get('/', (_req, res) => {
  res.json({ message: 'Bienvenue sur l\'API ARTISANTS 🚀', status: 'OK', apiVersion: API_VERSION });
});

// ============================================
// 5bis. Dashboard admin statique (build admin-web)
// Servi en same-origin → aucune config CORS requise
// ============================================
const adminDistPath = path.join(__dirname, '..', 'public', 'admin');
app.use('/admin', express.static(adminDistPath));
app.get(['/admin', '/admin/'], (_req, res) => {
  res.sendFile(path.join(adminDistPath, 'index.html'));
});
// Fallback SPA : toutes les sous-routes /admin/* retournent index.html
app.get('/admin/*', (_req, res) => {
  res.sendFile(path.join(adminDistPath, 'index.html'));
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
const server = app.listen(PORT, '0.0.0.0', () => {
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
