import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../../triggers/event-bus';
import { WorkflowEvent } from '../../models/types';

function createTestEvent(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return {
    id: 'evt-1',
    type: 'rdv_created',
    payload: { patient: { nom: 'Dupont' } },
    source: 'test',
    timestamp: new Date().toISOString(),
    organizationId: 'org-1',
    ...overrides,
  };
}

describe('EventBus', () => {
  beforeEach(() => {
    EventBus.resetInstance();
  });

  it('devrait être un singleton', () => {
    const bus1 = EventBus.getInstance();
    const bus2 = EventBus.getInstance();
    expect(bus1).toBe(bus2);
  });

  it('devrait réinitialiser le singleton avec resetInstance', () => {
    const bus1 = EventBus.getInstance();
    EventBus.resetInstance();
    const bus2 = EventBus.getInstance();
    expect(bus1).not.toBe(bus2);
  });

  describe('publish / subscribe', () => {
    it('devrait distribuer un event au handler abonné', async () => {
      const bus = EventBus.getInstance();
      const handler = vi.fn().mockResolvedValue(undefined);

      bus.subscribe('rdv_created', handler);
      await bus.publish(createTestEvent());

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-1', type: 'rdv_created' }));
    });

    it('devrait distribuer à plusieurs handlers du même type', async () => {
      const bus = EventBus.getInstance();
      const handler1 = vi.fn().mockResolvedValue(undefined);
      const handler2 = vi.fn().mockResolvedValue(undefined);

      bus.subscribe('rdv_created', handler1);
      bus.subscribe('rdv_created', handler2);
      await bus.publish(createTestEvent());

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('ne devrait pas appeler les handlers d\'autres types', async () => {
      const bus = EventBus.getInstance();
      const rdvHandler = vi.fn().mockResolvedValue(undefined);
      const cancelHandler = vi.fn().mockResolvedValue(undefined);

      bus.subscribe('rdv_created', rdvHandler);
      bus.subscribe('rdv_cancelled', cancelHandler);
      await bus.publish(createTestEvent({ type: 'rdv_created' }));

      expect(rdvHandler).toHaveBeenCalledTimes(1);
      expect(cancelHandler).not.toHaveBeenCalled();
    });

    it('devrait appeler les handlers globaux pour tout type', async () => {
      const bus = EventBus.getInstance();
      const globalHandler = vi.fn().mockResolvedValue(undefined);

      bus.subscribeAll(globalHandler);
      await bus.publish(createTestEvent({ type: 'rdv_created' }));
      await bus.publish(createTestEvent({ type: 'rdv_cancelled', id: 'evt-2' }));

      expect(globalHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('unsubscribe', () => {
    it('devrait se désabonner d\'un type', async () => {
      const bus = EventBus.getInstance();
      const handler = vi.fn().mockResolvedValue(undefined);

      bus.subscribe('rdv_created', handler);
      bus.unsubscribe('rdv_created', handler);
      await bus.publish(createTestEvent());

      expect(handler).not.toHaveBeenCalled();
    });

    it('devrait tout désabonner avec unsubscribeAll', async () => {
      const bus = EventBus.getInstance();
      const handler1 = vi.fn().mockResolvedValue(undefined);
      const handler2 = vi.fn().mockResolvedValue(undefined);

      bus.subscribe('rdv_created', handler1);
      bus.subscribeAll(handler2);
      bus.unsubscribeAll();

      await bus.publish(createTestEvent());

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('isolation des erreurs', () => {
    it('devrait isoler les erreurs entre handlers', async () => {
      const bus = EventBus.getInstance();
      const failingHandler = vi.fn().mockRejectedValue(new Error('boom'));
      const successHandler = vi.fn().mockResolvedValue(undefined);

      bus.subscribe('rdv_created', failingHandler);
      bus.subscribe('rdv_created', successHandler);
      await bus.publish(createTestEvent());

      expect(failingHandler).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledTimes(1);
    });

    it('devrait envoyer en DLQ quand un handler échoue', async () => {
      const bus = EventBus.getInstance();
      const dlqHandler = vi.fn().mockResolvedValue(undefined);
      const failingHandler = vi.fn().mockRejectedValue(new Error('erreur handler'));

      bus.setDeadLetterHandler(dlqHandler);
      bus.subscribe('rdv_created', failingHandler);
      await bus.publish(createTestEvent());

      expect(dlqHandler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'evt-1' }),
        'erreur handler'
      );
    });

    it('devrait envoyer en DLQ quand aucun handler n\'est enregistré', async () => {
      const bus = EventBus.getInstance();
      const dlqHandler = vi.fn().mockResolvedValue(undefined);

      bus.setDeadLetterHandler(dlqHandler);
      await bus.publish(createTestEvent());

      expect(dlqHandler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'evt-1' }),
        'Aucun handler enregistré'
      );
    });
  });

  describe('handlerCount', () => {
    it('devrait compter les handlers par type', () => {
      const bus = EventBus.getInstance();
      bus.subscribe('rdv_created', vi.fn());
      bus.subscribe('rdv_created', vi.fn());
      bus.subscribe('rdv_cancelled', vi.fn());

      expect(bus.handlerCount('rdv_created')).toBe(2);
      expect(bus.handlerCount('rdv_cancelled')).toBe(1);
      expect(bus.handlerCount('manual')).toBe(0);
    });

    it('devrait compter tous les handlers sans filtre', () => {
      const bus = EventBus.getInstance();
      bus.subscribe('rdv_created', vi.fn());
      bus.subscribe('rdv_cancelled', vi.fn());
      bus.subscribeAll(vi.fn());

      expect(bus.handlerCount()).toBe(3);
    });
  });
});
