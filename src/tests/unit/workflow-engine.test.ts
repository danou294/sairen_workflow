import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine } from '../../engine/workflow-engine';
import { WorkflowDefinition } from '../../models/types';
import {
  WorkflowNotFoundError,
  ExecutionNotAllowedError,
  InvalidTransitionError,
} from '../../errors/workflow-errors';

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
        id: '00000000-0000-0000-0000-000000000001',
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

    it('devrait retourner undefined pour un workflow inexistant', () => {
      expect(engine.getWorkflow('inexistant')).toBeUndefined();
    });
  });

  describe('registerWithValidation', () => {
    it('devrait accepter un workflow valide', () => {
      const wf = createTestWorkflow({
        steps: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Logger',
            type: 'log',
            config: { message: 'test' },
            onError: 'stop',
          },
        ],
      });
      const result = engine.registerWithValidation(wf);
      expect(result.success).toBe(true);
      expect(engine.getWorkflow('test-wf-1')).toBeDefined();
    });

    it('devrait rejeter un workflow sans nom', () => {
      const wf = createTestWorkflow({ name: '' });
      const result = engine.registerWithValidation(wf);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('devrait rejeter un workflow sans steps', () => {
      const wf = createTestWorkflow({ steps: [] });
      const result = engine.registerWithValidation(wf);
      expect(result.success).toBe(false);
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

    it('devrait permettre TESTING → DRAFT', () => {
      const wf = createTestWorkflow({ status: 'TESTING' });
      engine.register(wf);
      const updated = engine.changeStatus('test-wf-1', 'DRAFT');
      expect(updated.status).toBe('DRAFT');
    });

    it('devrait permettre ARCHIVED → DRAFT', () => {
      const wf = createTestWorkflow({ status: 'ARCHIVED' });
      engine.register(wf);
      const updated = engine.changeStatus('test-wf-1', 'DRAFT');
      expect(updated.status).toBe('DRAFT');
    });

    it('devrait refuser ARCHIVED → LIVE', () => {
      const wf = createTestWorkflow({ status: 'ARCHIVED' });
      engine.register(wf);
      expect(() => engine.changeStatus('test-wf-1', 'LIVE')).toThrow('Transition invalide');
    });

    it('devrait rejeter un changement sur un workflow inexistant', () => {
      expect(() => engine.changeStatus('inexistant', 'TESTING')).toThrow('introuvable');
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
      expect(result.workflowVersion).toBe(1);
    });

    it('devrait rejeter un workflow inexistant', async () => {
      await expect(engine.execute('inexistant', {})).rejects.toThrow('introuvable');
    });

    it('devrait rejeter l\'exécution d\'un workflow DRAFT', async () => {
      engine.register(createTestWorkflow({ status: 'DRAFT' }));
      await expect(engine.execute('test-wf-1', {})).rejects.toThrow(ExecutionNotAllowedError);
    });

    it('devrait rejeter l\'exécution d\'un workflow ARCHIVED', async () => {
      engine.register(createTestWorkflow({ status: 'ARCHIVED' }));
      await expect(engine.execute('test-wf-1', {})).rejects.toThrow(ExecutionNotAllowedError);
    });

    it('devrait rejeter TESTING sans mode sandbox', async () => {
      engine.register(createTestWorkflow({ status: 'TESTING' }));
      await expect(engine.execute('test-wf-1', {})).rejects.toThrow(ExecutionNotAllowedError);
    });

    it('devrait permettre TESTING en mode sandbox', async () => {
      engine.register(createTestWorkflow({ status: 'TESTING' }));
      const result = await engine.execute('test-wf-1', {}, { isSandbox: true });
      expect(result.status).toBe('COMPLETED');
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

    it('devrait exécuter un step dont la condition est vraie', async () => {
      const wf = createTestWorkflow({
        steps: [
          {
            id: 'step-cond',
            name: 'Step conditionnel',
            type: 'log',
            config: { message: 'Exécuté !' },
            condition: { field: 'status', operator: 'equals', value: 'confirmed' },
            onError: 'stop',
          },
        ],
      });

      engine.register(wf);
      const result = await engine.execute('test-wf-1', { status: 'confirmed' });

      expect(result.steps[0].status).toBe('success');
    });

    it('devrait gérer l\'idempotence', async () => {
      engine.register(createTestWorkflow());

      const result1 = await engine.execute('test-wf-1', {}, { idempotencyKey: 'key-1' });
      const result2 = await engine.execute('test-wf-1', {}, { idempotencyKey: 'key-1' });

      expect(result1.id).toBe(result2.id);
    });

    it('devrait marquer FAILED quand un step échoue avec onError=stop', async () => {
      engine.registerAction('fail_action', async () => {
        throw new Error('Erreur simulée');
      });

      const wf = createTestWorkflow({
        steps: [
          {
            id: 'step-fail',
            name: 'Step qui échoue',
            type: 'fail_action',
            config: {},
            onError: 'stop',
          },
          {
            id: 'step-after',
            name: 'Step après',
            type: 'log',
            config: { message: 'ne devrait pas passer' },
            onError: 'stop',
          },
        ],
      });

      engine.register(wf);
      const result = await engine.execute('test-wf-1', {});

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('Erreur simulée');
      expect(result.steps).toHaveLength(1); // Le second step n'est pas exécuté
    });

    it('devrait skipper un step qui échoue avec onError=skip', async () => {
      engine.registerAction('fail_action', async () => {
        throw new Error('Erreur simulée');
      });

      const wf = createTestWorkflow({
        steps: [
          {
            id: 'step-skip',
            name: 'Step skippable',
            type: 'fail_action',
            config: {},
            onError: 'skip',
          },
          {
            id: 'step-after',
            name: 'Step après',
            type: 'log',
            config: { message: 'devrait passer' },
            onError: 'stop',
          },
        ],
      });

      engine.register(wf);
      const result = await engine.execute('test-wf-1', {});

      expect(result.status).toBe('COMPLETED');
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].status).toBe('skipped');
      expect(result.steps[1].status).toBe('success');
    });

    it('devrait simuler les canaux en mode sandbox', async () => {
      engine.register(
        createTestWorkflow({
          steps: [
            {
              id: 'step-sms',
              name: 'Envoyer SMS',
              type: 'send_sms',
              config: { to: '0612345678', body: 'Test sandbox' },
              onError: 'stop',
            },
          ],
        })
      );

      const result = await engine.execute('test-wf-1', {}, { isSandbox: true });

      expect(result.status).toBe('COMPLETED');
      expect(result.steps[0].status).toBe('success');
      expect((result.steps[0].output as Record<string, unknown>).sandbox).toBe(true);
    });

    it('devrait enregistrer le trigger dans l\'exécution', async () => {
      engine.register(createTestWorkflow());
      const payload = { patient: { nom: 'Dupont' } };
      const result = await engine.execute('test-wf-1', payload);

      expect(result.trigger.type).toBe('manual');
      expect(result.trigger.payload).toEqual(payload);
    });

    it('devrait incrémenter le compteur d\'exécutions', async () => {
      engine.register(createTestWorkflow());

      await engine.execute('test-wf-1', {});
      await engine.execute('test-wf-1', {});

      const wf = engine.getWorkflow('test-wf-1')!;
      expect(wf.metadata.executionCount).toBe(2);
      expect(wf.metadata.lastExecutedAt).toBeDefined();
    });

    it('devrait compter les retries dans le résultat', async () => {
      let callCount = 0;
      engine.registerAction('flaky_action', async () => {
        callCount++;
        if (callCount < 3) throw new Error('Temporaire');
        return { ok: true };
      });

      const wf = createTestWorkflow({
        steps: [
          {
            id: 'step-retry',
            name: 'Retry step',
            type: 'flaky_action' as 'log',
            config: {},
            onError: 'retry',
            retryConfig: { maxRetries: 3, backoffMs: 1, backoffMultiplier: 1 },
          },
        ],
      });

      engine.register(wf);
      const result = await engine.execute('test-wf-1', {});

      expect(result.status).toBe('COMPLETED');
      expect(result.steps[0].status).toBe('success');
      expect(result.steps[0].retryCount).toBe(2);
    });

    it('devrait interpoler la config de manière récursive', async () => {
      engine.registerAction('check_config', async (step) => {
        return step.config;
      });

      const wf = createTestWorkflow({
        steps: [
          {
            id: 'step-interp',
            name: 'Interpolation récursive',
            type: 'check_config' as 'log',
            config: {
              message: 'Bonjour {{prenom}}',
              nested: { greeting: 'Salut {{prenom}}' },
            },
            onError: 'stop',
          },
        ],
      });

      engine.register(wf);
      const result = await engine.execute('test-wf-1', { prenom: 'Jean' });

      const output = result.steps[0].output as Record<string, unknown>;
      expect(output.message).toBe('Bonjour Jean');
      expect((output.nested as Record<string, unknown>).greeting).toBe('Salut Jean');
    });
  });

  describe('actions custom', () => {
    it('devrait enregistrer et exécuter une action custom', async () => {
      engine.registerAction('custom_action', async (step) => {
        return { result: `Custom: ${step.config.param}` };
      });

      const wf = createTestWorkflow({
        steps: [
          {
            id: 'step-custom',
            name: 'Action custom',
            type: 'custom_action',
            config: { param: 'hello' },
            onError: 'stop',
          },
        ],
      });

      engine.register(wf);
      const result = await engine.execute('test-wf-1', {});

      expect(result.status).toBe('COMPLETED');
      expect((result.steps[0].output as Record<string, unknown>).result).toBe('Custom: hello');
    });

    it('devrait échouer sur un type d\'action inconnu', async () => {
      const wf = createTestWorkflow({
        steps: [
          {
            id: 'step-unknown',
            name: 'Action inconnue',
            type: 'unknown_action' as 'log',
            config: {},
            onError: 'stop',
          },
        ],
      });

      engine.register(wf);
      const result = await engine.execute('test-wf-1', {});

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('inconnu');
    });
  });

  describe('transform', () => {
    it('devrait transformer des données via mappings', async () => {
      const wf = createTestWorkflow({
        steps: [
          {
            id: 'step-transform',
            name: 'Transformer',
            type: 'transform',
            config: {
              mappings: {
                fullName: 'patient.prenom',
              },
            },
            onError: 'stop',
          },
        ],
      });

      engine.register(wf);
      const result = await engine.execute('test-wf-1', {
        patient: { prenom: 'Jean' },
      });

      expect(result.status).toBe('COMPLETED');
      const output = result.steps[0].output as Record<string, unknown>;
      expect(output.fullName).toBe('Jean');
    });
  });

  describe('stats', () => {
    it('devrait retourner les statistiques globales', async () => {
      engine.register(createTestWorkflow());

      await engine.execute('test-wf-1', {});
      await engine.execute('test-wf-1', {});

      const stats = engine.getStats('test-wf-1');
      expect(stats.total).toBe(2);
      expect(stats.completed).toBe(2);
      expect(stats.failed).toBe(0);
      expect(stats.avgDuration).toBeGreaterThanOrEqual(0);
    });

    it('devrait retourner les stats globales sans filtre', async () => {
      engine.register(createTestWorkflow({ id: 'wf-a' }));
      engine.register(createTestWorkflow({ id: 'wf-b' }));

      await engine.execute('wf-a', {});
      await engine.execute('wf-b', {});

      const stats = engine.getStats();
      expect(stats.total).toBe(2);
    });

    it('devrait compter les échecs dans les stats', async () => {
      engine.registerAction('fail_action', async () => {
        throw new Error('boom');
      });

      engine.register(
        createTestWorkflow({
          steps: [
            { id: 's1', name: 'Fail', type: 'fail_action', config: {}, onError: 'stop' },
          ],
        })
      );

      await engine.execute('test-wf-1', {});

      const stats = engine.getStats('test-wf-1');
      expect(stats.failed).toBe(1);
    });
  });

  describe('execution history', () => {
    it('devrait retourner l\'historique par workflow', async () => {
      engine.register(createTestWorkflow({ id: 'wf-a' }));
      engine.register(createTestWorkflow({ id: 'wf-b' }));

      await engine.execute('wf-a', {});
      await engine.execute('wf-a', {});
      await engine.execute('wf-b', {});

      expect(engine.getExecutionHistory('wf-a')).toHaveLength(2);
      expect(engine.getExecutionHistory('wf-b')).toHaveLength(1);
      expect(engine.getExecutionHistory()).toHaveLength(3);
    });
  });

  describe('memory leak protection', () => {
    it('devrait limiter la taille de l\'historique', async () => {
      const smallEngine = new WorkflowEngine({ maxHistorySize: 3 });
      smallEngine.register(createTestWorkflow());

      for (let i = 0; i < 5; i++) {
        await smallEngine.execute('test-wf-1', {});
      }

      expect(smallEngine.getExecutionHistory()).toHaveLength(3);
    });
  });
});
