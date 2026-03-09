import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { manualTriggerSchema } from '../../models/schemas';
import { EventBus } from '../../triggers/event-bus';
import { publishManualEvent } from '../../triggers/manual-trigger';
import { createLogger } from '../../utils/logger';

const logger = createLogger('manual-trigger-route');

const paramsSchema = z.object({
  workflowId: z.string().uuid('workflowId doit être un UUID valide'),
});

/**
 * Plugin Fastify pour le trigger manuel.
 *
 * POST /api/v1/workflows/:workflowId/trigger
 * → Publie un event manuel sur l'EventBus, retourne 202.
 */
export async function manualTriggerRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Params: { workflowId: string };
    Body: z.infer<typeof manualTriggerSchema>;
  }>('/api/v1/workflows/:workflowId/trigger', async (request, reply) => {
    const paramsResult = paramsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Paramètres invalides',
        details: paramsResult.error.flatten().fieldErrors,
      });
    }

    const bodyResult = manualTriggerSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Payload invalide',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const { workflowId } = paramsResult.data;
    const { payload } = bodyResult.data;

    // TODO Sprint 4 : extraire organizationId du JWT
    const organizationId = (request.headers['x-organization-id'] as string) || 'unknown';

    const eventBus = EventBus.getInstance();
    const eventId = await publishManualEvent(eventBus, workflowId, payload, organizationId);

    logger.info({ eventId, workflowId }, 'Trigger manuel accepté');

    return reply.status(202).send({
      eventId,
      status: 'accepted',
    });
  });
}
