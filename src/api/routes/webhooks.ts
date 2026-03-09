import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { webhookPayloadSchema } from '../../models/schemas';
import { EventBus } from '../../triggers/event-bus';
import { WorkflowEvent } from '../../models/types';
import { createLogger } from '../../utils/logger';

const logger = createLogger('webhook-route');

const paramsSchema = z.object({
  organizationId: z.string().uuid('organizationId doit être un UUID valide'),
});

/**
 * Plugin Fastify pour le webhook trigger.
 *
 * POST /api/v1/webhooks/:organizationId
 * → Valide le payload Zod, publie un WorkflowEvent sur l'EventBus, retourne 202.
 */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Params: { organizationId: string };
    Body: z.infer<typeof webhookPayloadSchema>;
  }>('/api/v1/webhooks/:organizationId', async (request, reply) => {
    // Valider les params
    const paramsResult = paramsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Paramètres invalides',
        details: paramsResult.error.flatten().fieldErrors,
      });
    }

    // Valider le body
    const bodyResult = webhookPayloadSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Payload invalide',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const { organizationId } = paramsResult.data;
    const { type, payload, correlationId } = bodyResult.data;

    const event: WorkflowEvent = {
      id: randomUUID(),
      type,
      payload,
      source: 'webhook',
      timestamp: new Date().toISOString(),
      organizationId,
      correlationId,
    };

    logger.info(
      { eventId: event.id, type, organizationId },
      'Webhook reçu'
    );

    const eventBus = EventBus.getInstance();
    await eventBus.publish(event);

    return reply.status(202).send({
      eventId: event.id,
      status: 'accepted',
    });
  });
}
