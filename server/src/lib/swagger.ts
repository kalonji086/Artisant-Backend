import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ARTISANTS API',
      version: '1.0.0',
      description: 'API pour la plateforme de mise en relation clients / artisans',
      contact: {
        name: 'Support ARTISANTS',
        email: 'support@artisants.com',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000/api/v1',
        description: 'Serveur de développement local',
      },
      {
        url: 'https://api.artisants.com/api/v1',
        description: 'Serveur de production',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Token JWT Supabase obtenu après connexion',
        },
      },
      schemas: {
        Profile: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            full_name: { type: 'string' },
            phone: { type: 'string' },
            role: { type: 'string', enum: ['client', 'artisan'] },
            avatar_url: { type: 'string' },
            location: { type: 'object' },
            address: { type: 'string' },
            description: { type: 'string' },
            is_available: { type: 'boolean' },
            rating: { type: 'number' },
            expo_push_token: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Quote: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            client_id: { type: 'string', format: 'uuid' },
            artisan_id: { type: 'string', format: 'uuid' },
            service_id: { type: 'string', format: 'uuid' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'accepted', 'rejected', 'completed'] },
            price: { type: 'number' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/api/*.routes.ts', './src/api/*.controller.ts'],
};

const swaggerSpec = swaggerJsdoc(options);

export const setupSwagger = (app: Express) => {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: '.swagger-ui .topbar { background-color: #007AFF }',
    customSiteTitle: 'ARTISANTS API Documentation',
  }));
  app.get('/api/docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
};