import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine } from '../../engine/workflow-engine';
import { WorkflowDefinition } from '../../models/types';

function createTestWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'test-wf-1',
    name: 'Workflow de test',
    description: 'Un workflow pour les tests',
    version: 1,
    status: 'LIVE',
    trigger: { type: 'manual', config: {} },
    steps: [
      {
        id: 'step-1',
        name: 'Logger',
        type: 'log',
        config: { message: 'Test step exécuté' },
        onError: 'stop',
      },
    ],
    variables: [],
    tags: ['test'],
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

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
  });

  describe('register / unregister', () => {
    it('devrait enregistrer un workflow', () => {
      const wf = createTestWorkflow();
      engine.register(wf);
      expect(engine.getWorkflow('test-wf-1')).toBeDefined();
      expect(engine.getWorkflow('test-wf-1')?.name).toBe('Workflow de test');
    });

    it('devrait lister les workflows enregistrés', () => {
      engine.register(createTestWorkflow({ id: 'wf-1', name: 'WF 1' }));
      engine.register(createTestWorkflow({ id: 'wf-2', name: 'WF 2' }));
      expect(engine.listWorkflows()).toHaveLength(2);
    });

    it('devrait supprimer un workflow', () => {
      engine.register(createTestWorkflow());
      engine.unregister('test-wf-1');
      expect(engine.getWorkflow('test-wf-1')).toBeUndefined();
    });
  });

  describe('lifecycle', () => {
    it('devrait permettre DRAFT → TESTING', () => {
      const wf = createTestWorkflow({ status: 'DRAFT' });
      engine.register(wf);
      const updated = engine.changeStatus('test-wf-1', 'TESTING');
      expect(updated.status).toBe('TESTING');
    });

    it('devrait refuser une transition invalide DRAFT → LIVE', () => {
      const wf = createTestWorkflow({ status: 'DRAFT' });
      engine.register(wf);
      expect(() => engine.changeStatus('test-wf-1', 'LIVE')).toThrow('Transition invalide');
    });

    it('devrait permettre LIVE → ARCHIVED', () => {
      const wf = createTestWorkflow({ status: 'LIVE' });
      engine.register(wf);
      const updated = engine.changeStatus('test-wf-1', 'ARCHIVED');
      expect(updated.status).toBe('ARCHIVED');
    });
  });

  describe('execute', () => {
    it('devrait exécuter un workflow avec un step log', async () => {
      engine.register(createTestWorkflow());
      const result = await engine.execute('test-wf-1', { patient: { nom: 'Dupont' } });

      expect(result.status).toBe('COMPLETED');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].status).toBe('success');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('devrait rejeter un workflow inexistant', async () => {
      await expect(engine.execute('inexistant', {})).rejects.toThrow('introuvable');
    });

    it('devrait enrichir le contexte entre les steps', async () => {
      const wf = createTestWorkflow({
        steps: [
          {
            id: 'step-enrich',
            name: 'Enrichir',
            type: 'enrich',
            config: { data: { source: 'doctolib' } },
            onError: 'stop',
          },
          {
            id: 'step-log',
            name: 'Logger',
            type: 'log',
            config: { message: 'Source: {{source}}' },
            onError: 'stop',
          },
        ],
      });

      engine.register(wf);
      const result = await engine.execute('test-wf-1', {});

      expect(result.status).toBe('COMPLETED');
      expect(result.steps).toHaveLength(2);
      expect(result.context).toHaveProperty('source', 'doctolib');
    });

    it('devrait skipper un step dont la condition est fausse', async () => {
      const wf = createTestWorkflow({
        steps: [
          {
            id: 'step-cond',
            name: 'Step conditionnel',
            type: 'log',
            config: { message: 'Ne devrait pas être exécuté' },
            condition: { field: 'status', operator: 'equals', value: 'cancelled' },
            onError: 'stop',
          },
        ],
      });

      engine.register(wf);
      const result = await engine.execute('test-wf-1', { status: 'confirmed' });

      expect(result.steps[0].status).toBe('skipped');
    });

    it('devrait gérer l\'idempotence', async () => {
      engine.register(createTestWorkflow());

      const result1 = await engine.execute('test-wf-1', {}, { idempotencyKey: 'key-1' });
      const result2 = await engine.execute('test-wf-1', {}, { idempotencyKey: 'key-1' });

      expect(result1.id).toBe(result2.id);
    });
  });

  describe('stats', () => {
    it('devrait retourner les statistiques', async () => {
      engine.register(createTestWorkflow());

      await engine.execute('test-wf-1', {});
      await engine.execute('test-wf-1', {});

      const stats = engine.getStats('test-wf-1');
      expect(stats.total).toBe(2);
      expect(stats.completed).toBe(2);
      expect(stats.failed).toBe(0);
    });
  });
});
