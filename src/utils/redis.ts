import Redis from 'ioredis';
import { config } from '../config';
import { createLogger } from './logger';

const logger = createLogger('redis');

/** Crée une connexion Redis avec les paramètres de config */
export function createRedisConnection(name?: string): Redis {
  const connection = new Redis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Requis par BullMQ
    lazyConnect: true,
  });

  connection.on('connect', () => {
    logger.info({ name: name ?? 'default' }, 'Connexion Redis établie');
  });

  connection.on('error', (err) => {
    logger.error({ name: name ?? 'default', error: err.message }, 'Erreur Redis');
  });

  return connection;
}

let sharedConnection: Redis | null = null;

/** Retourne une connexion Redis partagée (singleton) */
export function getSharedRedisConnection(): Redis {
  if (!sharedConnection) {
    sharedConnection = createRedisConnection('shared');
  }
  return sharedConnection;
}

/** Ferme la connexion partagée */
export async function closeSharedRedisConnection(): Promise<void> {
  if (sharedConnection) {
    await sharedConnection.quit();
    sharedConnection = null;
  }
}

/** Retourne les options de connexion Redis pour BullMQ (évite les conflits de types ioredis) */
export function getRedisConnectionOptions(): {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest: null;
} {
  return {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  };
}
