import Fastify from 'fastify';
import { config } from './config';
import { createLogger } from './utils/logger';

const logger = createLogger('server');

export async function buildApp() {
  const app = Fastify({
    logger: false, // On utilise Pino directement
  });

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    environment: config.NODE_ENV,
  }));

  // Health check détaillé (readiness)
  app.get('/health/ready', async () => {
    // TODO Sprint 5 : vérifier PostgreSQL + Redis
    return {
      status: 'ok',
      services: {
        api: 'up',
        database: 'unchecked',
        redis: 'unchecked',
      },
    };
  });

  // Route racine
  app.get('/', async () => ({
    name: 'Sairen Workflow Engine',
    version: '0.1.0',
    docs: '/docs',
  }));

  return app;
}

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    logger.info(
      { port: config.PORT, env: config.NODE_ENV },
      `🚀 Sairen Workflow Engine démarré sur http://${config.HOST}:${config.PORT}`
    );
  } catch (err) {
    logger.fatal(err, 'Erreur fatale au démarrage');
    process.exit(1);
  }

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const signal of signals) {
    process.on(signal, async () => {
      logger.info({ signal }, 'Signal reçu, arrêt gracieux...');
      await app.close();
      process.exit(0);
    });
  }
}

// Démarrer seulement si exécuté directement (pas en import)
if (require.main === module) {
  start();
}
