import { describe, it, expect, beforeEach } from 'vitest';
import { DeadLetterQueue } from '../../triggers/dead-letter-queue';
import { WorkflowEvent } from '../../models/types';

function createTestEvent(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return {
    id: 'evt-1',
    type: 'rdv_created',
    payload: {},
    source: 'test',
    timestamp: new Date().toISOString(),
    organizationId: 'org-1',
    ...overrides,
  };
}

describe('DeadLetterQueue', () => {
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dlq = new DeadLetterQueue();
  });

  it('devrait ajouter un event et retourner un ID', async () => {
    const id = await dlq.add(createTestEvent(), 'Erreur test');
    expect(id).toBeDefined();
    expect(dlq.size).toBe(1);
  });

  it('devrait récupérer les entrées (plus récentes en premier)', async () => {
    await dlq.add(createTestEvent({ id: 'evt-1' }), 'Erreur 1');
    await dlq.add(createTestEvent({ id: 'evt-2' }), 'Erreur 2');

    const entries = dlq.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].event.id).toBe('evt-2');
    expect(entries[1].event.id).toBe('evt-1');
  });

  it('devrait limiter les résultats avec le paramètre limit', async () => {
    await dlq.add(createTestEvent({ id: 'evt-1' }), 'Erreur 1');
    await dlq.add(createTestEvent({ id: 'evt-2' }), 'Erreur 2');
    await dlq.add(createTestEvent({ id: 'evt-3' }), 'Erreur 3');

    expect(dlq.getEntries(2)).toHaveLength(2);
  });

  it('devrait trouver une entrée par ID', async () => {
    const id = await dlq.add(createTestEvent(), 'Erreur test');
    const entry = dlq.findById(id);

    expect(entry).toBeDefined();
    expect(entry!.error).toBe('Erreur test');
  });

  it('devrait marquer comme retentée', async () => {
    const id = await dlq.add(createTestEvent(), 'Erreur test');

    dlq.markRetried(id);
    dlq.markRetried(id);

    const entry = dlq.findById(id);
    expect(entry!.retryCount).toBe(2);
  });

  it('devrait supprimer une entrée', async () => {
    const id = await dlq.add(createTestEvent(), 'Erreur test');
    expect(dlq.remove(id)).toBe(true);
    expect(dlq.size).toBe(0);
    expect(dlq.remove('inexistant')).toBe(false);
  });

  it('devrait purger toute la DLQ', async () => {
    await dlq.add(createTestEvent({ id: 'evt-1' }), 'Erreur 1');
    await dlq.add(createTestEvent({ id: 'evt-2' }), 'Erreur 2');

    const count = dlq.purge();
    expect(count).toBe(2);
    expect(dlq.size).toBe(0);
  });

  it('devrait respecter la taille max (buffer circulaire)', async () => {
    const smallDlq = new DeadLetterQueue({ maxSize: 3 });

    for (let i = 0; i < 5; i++) {
      await smallDlq.add(createTestEvent({ id: `evt-${i}` }), `Erreur ${i}`);
    }

    expect(smallDlq.size).toBe(3);
    // Les 2 premiers ont été supprimés
    const entries = smallDlq.getEntries();
    expect(entries[0].event.id).toBe('evt-4');
  });
});
