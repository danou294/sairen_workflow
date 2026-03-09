import { randomUUID } from 'crypto';
import { Queue, Worker, Job } from 'bullmq';
import { WorkflowEvent } from '../models/types';
import { EventBus } from './event-bus';
import { createLogger } from '../utils/logger';

const logger = createLogger('cron-trigger');

const QUEUE_NAME = 'sairen:cron-events';

/** Options de connexion Redis pour BullMQ */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest?: null;
}

export interface CronRegistration {
  workflowId: string;
  cronExpression: string;
  organizationId: string;
  jobKey?: string;
}

/**
 * CronTriggerManager — gère les triggers CRON via BullMQ repeat jobs.
 *
 * Chaque workflow avec trigger.type === 'cron' a un job BullMQ repeatable.
 * Quand le job se déclenche, il publie un WorkflowEvent sur l'EventBus.
 */
export class CronTriggerManager {
  private queue: Queue;
  private worker: Worker;
  private registrations: Map<string, CronRegistration> = new Map();

  constructor(
    private connectionOpts: RedisConnectionOptions,
    private eventBus: EventBus
  ) {
    this.queue = new Queue(QUEUE_NAME, { connection: this.connectionOpts });

    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => this.processJob(job),
      {
        connection: this.connectionOpts,
        concurrency: 1,
      }
    );

    this.worker.on('failed', (job, err) => {
      logger.error(
        { jobId: job?.id, error: err.message },
        'CRON job échoué'
      );
    });

    logger.info('CronTriggerManager initialisé');
  }

  /** Enregistre un CRON pour un workflow */
  async registerCron(
    workflowId: string,
    cronExpression: string,
    organizationId: string
  ): Promise<void> {
    // Supprimer l'ancien si existant
    await this.unregisterCron(workflowId);

    const job = await this.queue.add(
      `cron:${workflowId}`,
      { workflowId, organizationId },
      {
        repeat: { pattern: cronExpression },
        jobId: `cron-${workflowId}`,
      }
    );

    this.registrations.set(workflowId, {
      workflowId,
      cronExpression,
      organizationId,
      jobKey: job.repeatJobKey,
    });

    logger.info(
      { workflowId, cronExpression, organizationId },
      'CRON enregistré'
    );
  }

  /** Supprime le CRON d'un workflow */
  async unregisterCron(workflowId: string): Promise<void> {
    const registration = this.registrations.get(workflowId);
    if (registration?.jobKey) {
      await this.queue.removeRepeatableByKey(registration.jobKey);
      this.registrations.delete(workflowId);
      logger.info({ workflowId }, 'CRON désenregistré');
    }
  }

  /** Liste les CRONs actifs */
  listCrons(): CronRegistration[] {
    return Array.from(this.registrations.values());
  }

  /** Processor : publie un event sur l'EventBus quand le CRON tick */
  private async processJob(job: Job): Promise<void> {
    const { workflowId, organizationId } = job.data as {
      workflowId: string;
      organizationId: string;
    };

    const event: WorkflowEvent = {
      id: randomUUID(),
      type: 'cron',
      payload: { workflowId, scheduledAt: new Date().toISOString() },
      source: 'cron-scheduler',
      timestamp: new Date().toISOString(),
      organizationId,
    };

    logger.info(
      { eventId: event.id, workflowId, jobId: job.id },
      'CRON tick — event publié'
    );

    await this.eventBus.publish(event);
  }

  /** Fermeture gracieuse */
  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    logger.info('CronTriggerManager fermé');
  }
}
