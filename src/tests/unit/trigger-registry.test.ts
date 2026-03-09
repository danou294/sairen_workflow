import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../../triggers/event-bus';
import { TriggerRegistry } from '../../triggers/trigger-registry';
import { WorkflowEngine } from '../../engine/workflow-engine';
import { WorkflowDefinition, WorkflowEvent } from '../../models/types';

function createTestWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'wf-1',
    name: 'Workflow test',
    description: 'Test',
    version: 1,
    status: 'LIVE',
    trigger: { type: 'rdv_created', config: {} },
    steps: [
      {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Log',
        type: 'log',
        config: { message: 'test' },
        onError: 'stop',
      },
    ],
    variables: [],
    tags: [],
    metadata: {
      createdBy: 'user-1',
      organizationId: 'org-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionCount: 0,
    },
    ...overrides,
  };
}

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

describe('TriggerRegistry', () => {
  let eventBus: EventBus;
  let engine: WorkflowEngine;
  let registry: TriggerRegistry;

  beforeEach(() => {
    EventBus.resetInstance();
    eventBus = EventBus.getInstance();
    engine = new WorkflowEngine();
    registry = new TriggerRegistry(eventBus, engine);
  });

  it('devrait enregistrer un workflow et router les events', async () => {
    const wf = createTestWorkflow();
    engine.register(wf);
    registry.registerWorkflow(wf);

    expect(registry.size).toBe(1);

    await eventBus.publish(createTestEvent());

    // Le workflow a été exécuté
    const history = engine.getExecutionHistory('wf-1');
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('COMPLETED');
  });

  it('devrait isoler par organizationId', async () => {
    const wf = createTestWorkflow({ metadata: { ...createTestWorkflow().metadata, organizationId: 'org-1' } });
    engine.register(wf);
    registry.registerWorkflow(wf);

    // Event d'une autre orga — ne doit pas déclencher
    await eventBus.publish(createTestEvent({ organizationId: 'org-2' }));

    expect(engine.getExecutionHistory('wf-1')).toHaveLength(0);
  });

  it('devrait évaluer les filtres du trigger', async () => {
    const wf = createTestWorkflow({
      trigger: {
        type: 'rdv_created',
        config: {},
        filters: [{ field: 'patient.type', operator: 'equals', value: 'vip' }],
      },
    });
    engine.register(wf);
    registry.registerWorkflow(wf);

    // Event sans le bon filtre — ne doit pas déclencher
    await eventBus.publish(createTestEvent({ payload: { patient: { type: 'standard' } } }));
    expect(engine.getExecutionHistory('wf-1')).toHaveLength(0);

    // Event avec le bon filtre — doit déclencher
    await eventBus.publish(createTestEvent({ id: 'evt-2', payload: { patient: { type: 'vip' } } }));
    expect(engine.getExecutionHistory('wf-1')).toHaveLength(1);
  });

  it('devrait supporter le fan-out (plusieurs workflows pour le même type)', async () => {
    const wf1 = createTestWorkflow({ id: 'wf-1' });
    const wf2 = createTestWorkflow({ id: 'wf-2' });

    engine.register(wf1);
    engine.register(wf2);
    registry.registerWorkflow(wf1);
    registry.registerWorkflow(wf2);

    await eventBus.publish(createTestEvent());

    expect(engine.getExecutionHistory('wf-1')).toHaveLength(1);
    expect(engine.getExecutionHistory('wf-2')).toHaveLength(1);
  });

  it('devrait désenregistrer un workflow', async () => {
    const wf = createTestWorkflow();
    engine.register(wf);
    registry.registerWorkflow(wf);
    registry.unregisterWorkflow('wf-1');

    expect(registry.size).toBe(0);

    await eventBus.publish(createTestEvent());
    expect(engine.getExecutionHistory('wf-1')).toHaveLength(0);
  });

  it('devrait synchroniser les workflows actifs', () => {
    engine.register(createTestWorkflow({ id: 'wf-live', status: 'LIVE' }));
    engine.register(createTestWorkflow({ id: 'wf-testing', status: 'TESTING' }));
    engine.register(createTestWorkflow({ id: 'wf-draft', status: 'DRAFT' }));
    engine.register(createTestWorkflow({ id: 'wf-archived', status: 'ARCHIVED' }));

    registry.syncActiveWorkflows();

    expect(registry.size).toBe(2); // Seuls LIVE et TESTING
    const registered = registry.getRegisteredWorkflows();
    expect(registered.has('wf-live')).toBe(true);
    expect(registered.has('wf-testing')).toBe(true);
    expect(registered.has('wf-draft')).toBe(false);
  });

  it('devrait nettoyer avec clear()', () => {
    engine.register(createTestWorkflow({ id: 'wf-1' }));
    engine.register(createTestWorkflow({ id: 'wf-2' }));
    registry.registerWorkflow(createTestWorkflow({ id: 'wf-1' }));
    registry.registerWorkflow(createTestWorkflow({ id: 'wf-2' }));

    registry.clear();
    expect(registry.size).toBe(0);
  });
});
