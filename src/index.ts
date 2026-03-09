import Fastify from 'fastify';
import { config } from './config';
import prisma from './engine/prisma-client';
import { WorkflowEngine } from './engine/workflow-engine';
import { EventBus } from './triggers/event-bus';
import { TriggerRegistry } from './triggers/trigger-registry';
import { DeadLetterQueue } from './triggers/dead-letter-queue';
import { CronTriggerManager } from './triggers/cron-trigger';
import { webhookRoutes } from './api/routes/webhooks';
import { manualTriggerRoutes } from './api/routes/manual-trigger';
import { getRedisConnectionOptions } from './utils/redis';
import { createLogger } from './utils/logger';

const logger = createLogger('server');

// --- Instances globales (initialisées au start) ---
let cronManager: CronTriggerManager | null = null;
let triggerRegistry: TriggerRegistry | null = null;

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
  app.get('/health/ready', async () => ({
    status: 'ok',
    services: {
      api: 'up',
      database: 'unchecked',
      redis: 'unchecked',
    },
  }));

  // Route racine
  app.get('/', async () => ({
    name: 'Sairen Workflow Engine',
    version: '0.1.0',
    docs: '/docs',
  }));

  // Routes API Sprint 2
  await app.register(webhookRoutes);
  await app.register(manualTriggerRoutes);

  return app;
}

async function start() {
  const app = await buildApp();

  // --- Initialisation du système de triggers ---

  // 1. EventBus
  const eventBus = EventBus.getInstance();

  // 2. Dead Letter Queue
  const dlq = new DeadLetterQueue();
  eventBus.setDeadLetterHandler(async (event, error) => {
    await dlq.add(event, error);
  });

  // 3. Workflow Engine (mode persistant)
  const engine = new WorkflowEngine({ persistent: true });

  // 4. TriggerRegistry
  triggerRegistry = new TriggerRegistry(eventBus, engine);

  // 5. Charger les workflows actifs et les enregistrer
  try {
    const count = await engine.loadActiveWorkflows();
    triggerRegistry.syncActiveWorkflows();
    logger.info({ count }, 'Workflows actifs chargés et triggers enregistrés');
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Impossible de charger les workflows depuis la DB');
  }

  // 6. CRON trigger manager
  try {
    const redisOpts = getRedisConnectionOptions();
    cronManager = new CronTriggerManager(redisOpts, eventBus);

    // Enregistrer les CRONs pour les workflows qui ont trigger.type === 'cron'
    for (const wf of engine.listWorkflows()) {
      if (wf.trigger.type === 'cron' && wf.status === 'LIVE') {
        const cronExpr = wf.trigger.config.cronExpression as string;
        if (cronExpr) {
          await cronManager.registerCron(wf.id, cronExpr, wf.metadata.organizationId);
        }
      }
    }
    logger.info({ crons: cronManager.listCrons().length }, 'CRON triggers enregistrés');
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Impossible d\'initialiser le CRON manager');
  }

  // --- Démarrage du serveur ---

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    logger.info(
      { port: config.PORT, env: config.NODE_ENV },
      `Sairen Workflow Engine démarré sur http://${config.HOST}:${config.PORT}`
    );
  } catch (err) {
    logger.fatal(err, 'Erreur fatale au démarrage');
    process.exit(1);
  }

  // --- Graceful shutdown ---

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const signal of signals) {
    process.on(signal, async () => {
      logger.info({ signal }, 'Signal reçu, arrêt gracieux...');

      // Ordre de fermeture : CRON → TriggerRegistry → EventBus → DB
      if (cronManager) await cronManager.close().catch(() => {});
      if (triggerRegistry) triggerRegistry.clear();
      EventBus.resetInstance();

      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    });
  }
}

// Démarrer seulement si exécuté directement (pas en import)
if (require.main === module) {
  start();
}
