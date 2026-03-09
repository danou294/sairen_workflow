import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../../triggers/event-bus';
import { publishManualEvent } from '../../triggers/manual-trigger';

describe('Manual Trigger', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    EventBus.resetInstance();
    eventBus = EventBus.getInstance();
  });

  it('devrait publier un event de type manual', async () => {
    const publishSpy = vi.spyOn(eventBus, 'publish').mockResolvedValue(undefined);

    const eventId = await publishManualEvent(
      eventBus,
      'wf-1',
      { patient: { nom: 'Dupont' } },
      'org-1'
    );

    expect(eventId).toBeDefined();
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'manual',
        source: 'manual',
        organizationId: 'org-1',
        payload: expect.objectContaining({
          _targetWorkflowId: 'wf-1',
          patient: { nom: 'Dupont' },
        }),
      })
    );
  });

  it('devrait générer un ID unique par appel', async () => {
    vi.spyOn(eventBus, 'publish').mockResolvedValue(undefined);

    const id1 = await publishManualEvent(eventBus, 'wf-1', {}, 'org-1');
    const id2 = await publishManualEvent(eventBus, 'wf-1', {}, 'org-1');

    expect(id1).not.toBe(id2);
  });
});
