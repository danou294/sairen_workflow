import { randomUUID } from 'crypto';
import { WorkflowEvent } from '../models/types';
import { EventBus } from './event-bus';
import { createLogger } from '../utils/logger';

const logger = createLogger('manual-trigger');

/**
 * Publie un event manuel sur l'EventBus.
 *
 * Formalise le trigger manuel via le même pipeline que les webhooks et CRON
 * (filtres, DLQ, logging unifié).
 */
export async function publishManualEvent(
  eventBus: EventBus,
  workflowId: string,
  payload: Record<string, unknown>,
  organizationId: string
): Promise<string> {
  const event: WorkflowEvent = {
    id: randomUUID(),
    type: 'manual',
    payload: { ...payload, _targetWorkflowId: workflowId },
    source: 'manual',
    timestamp: new Date().toISOString(),
    organizationId,
  };

  logger.info(
    { eventId: event.id, workflowId, organizationId },
    'Trigger manuel publié'
  );

  await eventBus.publish(event);
  return event.id;
}
