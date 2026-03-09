import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { webhookRoutes } from '../../api/routes/webhooks';
import { EventBus } from '../../triggers/event-bus';

describe('Webhook Trigger Route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    EventBus.resetInstance();
    app = Fastify();
    await app.register(webhookRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    EventBus.resetInstance();
  });

  const validOrgId = '00000000-0000-0000-0000-000000000001';

  it('devrait accepter un payload valide et retourner 202', async () => {
    const publishSpy = vi.spyOn(EventBus.getInstance(), 'publish').mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${validOrgId}`,
      payload: {
        type: 'rdv_created',
        payload: { patient: { nom: 'Dupont' } },
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.payload);
    expect(body.eventId).toBeDefined();
    expect(body.status).toBe('accepted');
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it('devrait rejeter un payload sans type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${validOrgId}`,
      payload: {
        payload: { data: 'test' },
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('Payload invalide');
  });

  it('devrait rejeter un type de trigger invalide', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${validOrgId}`,
      payload: {
        type: 'type_invalide',
        payload: {},
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('devrait rejeter un organizationId invalide', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/pas-un-uuid',
      payload: {
        type: 'rdv_created',
        payload: {},
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('Paramètres invalides');
  });

  it('devrait transmettre le correlationId dans l\'event', async () => {
    const publishSpy = vi.spyOn(EventBus.getInstance(), 'publish').mockResolvedValue(undefined);
    const correlationId = '11111111-1111-1111-1111-111111111111';

    await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${validOrgId}`,
      payload: {
        type: 'rdv_created',
        payload: {},
        correlationId,
      },
    });

    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId })
    );
  });
});
