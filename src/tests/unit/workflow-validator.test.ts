import { describe, it, expect } from 'vitest';
import { WorkflowValidator } from '../../engine/workflow-validator';
import { WorkflowDefinition } from '../../models/types';

function createValidWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'wf-valid',
    name: 'Workflow valide',
    description: 'Un workflow pour les tests de validation',
    version: 1,
    status: 'DRAFT',
    trigger: { type: 'manual', config: {} },
    steps: [
      {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        name: 'Logger',
        type: 'log',
        config: { message: 'Test' },
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

describe('WorkflowValidator', () => {
  const validator = new WorkflowValidator();

  describe('validate — structure', () => {
    it('devrait valider un workflow correct', () => {
      const result = validator.validate(createValidWorkflow());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('devrait rejeter un workflow sans nom', () => {
      const result = validator.validate(createValidWorkflow({ name: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('nom'))).toBe(true);
    });

    it('devrait rejeter un workflow sans steps', () => {
      const result = validator.validate(createValidWorkflow({ steps: [] }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('step'))).toBe(true);
    });
  });

  describe('validate — steps', () => {
    it('devrait rejeter un step retry sans retryConfig', () => {
      const wf = createValidWorkflow({
        steps: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Step retry',
            type: 'log',
            config: { message: 'test' },
            onError: 'retry',
            // pas de retryConfig
          },
        ],
      });
      const result = validator.validate(wf);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('retryConfig'))).toBe(true);
    });

    it('devrait rejeter un step delay sans duration', () => {
      const wf = createValidWorkflow({
        steps: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Attendre',
            type: 'delay',
            config: {},
            onError: 'stop',
          },
        ],
      });
      const result = validator.validate(wf);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('durée'))).toBe(true);
    });

    it('devrait rejeter des IDs de step dupliqués', () => {
      const wf = createValidWorkflow({
        steps: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Step 1',
            type: 'log',
            config: { message: 'a' },
            onError: 'stop',
          },
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Step 2',
            type: 'log',
            config: { message: 'b' },
            onError: 'stop',
          },
        ],
      });
      const result = validator.validate(wf);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('dupliqué'))).toBe(true);
    });

    it('devrait rejeter un step next vers un ID inexistant', () => {
      const wf = createValidWorkflow({
        steps: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Step 1',
            type: 'log',
            config: { message: 'a' },
            onError: 'stop',
            next: '00000000-0000-0000-0000-000000000000',
          },
        ],
      });
      const result = validator.validate(wf);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('inexistant'))).toBe(true);
    });
  });

  describe('validate — conditions', () => {
    it('devrait rejeter une condition sans champ', () => {
      const wf = createValidWorkflow({
        steps: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Step cond',
            type: 'log',
            config: { message: 'test' },
            onError: 'stop',
            condition: { field: '', operator: 'equals', value: 'test' },
          },
        ],
      });
      const result = validator.validate(wf);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('champ'))).toBe(true);
    });

    it('devrait rejeter une condition equals sans valeur', () => {
      const wf = createValidWorkflow({
        steps: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Step cond',
            type: 'log',
            config: { message: 'test' },
            onError: 'stop',
            condition: { field: 'status', operator: 'equals' },
          },
        ],
      });
      const result = validator.validate(wf);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('valeur'))).toBe(true);
    });

    it('devrait accepter exists sans valeur', () => {
      const wf = createValidWorkflow({
        steps: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Step exists',
            type: 'log',
            config: { message: 'test' },
            onError: 'stop',
            condition: { field: 'phone', operator: 'exists' },
          },
        ],
      });
      const result = validator.validate(wf);
      // Pas d'erreur sur la condition exists sans value
      const conditionErrors = result.errors.filter((e) => e.message.includes('valeur'));
      expect(conditionErrors).toHaveLength(0);
    });
  });

  describe('validateTransition', () => {
    it('devrait accepter DRAFT → TESTING', () => {
      const result = validator.validateTransition('DRAFT', 'TESTING');
      expect(result.valid).toBe(true);
    });

    it('devrait accepter TESTING → LIVE', () => {
      const result = validator.validateTransition('TESTING', 'LIVE');
      expect(result.valid).toBe(true);
    });

    it('devrait accepter TESTING → DRAFT', () => {
      const result = validator.validateTransition('TESTING', 'DRAFT');
      expect(result.valid).toBe(true);
    });

    it('devrait accepter LIVE → ARCHIVED', () => {
      const result = validator.validateTransition('LIVE', 'ARCHIVED');
      expect(result.valid).toBe(true);
    });

    it('devrait accepter ARCHIVED → DRAFT', () => {
      const result = validator.validateTransition('ARCHIVED', 'DRAFT');
      expect(result.valid).toBe(true);
    });

    it('devrait refuser DRAFT → LIVE', () => {
      const result = validator.validateTransition('DRAFT', 'LIVE');
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Transition invalide');
    });

    it('devrait refuser DRAFT → ARCHIVED', () => {
      const result = validator.validateTransition('DRAFT', 'ARCHIVED');
      expect(result.valid).toBe(false);
    });

    it('devrait refuser ARCHIVED → LIVE', () => {
      const result = validator.validateTransition('ARCHIVED', 'LIVE');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateForTesting', () => {
    it('devrait valider un workflow prêt pour le test', () => {
      const result = validator.validateForTesting(createValidWorkflow());
      expect(result.valid).toBe(true);
    });

    it('devrait rejeter un workflow sans trigger', () => {
      const wf = createValidWorkflow({
        trigger: { type: '' as 'manual', config: {} },
      });
      const result = validator.validateForTesting(wf);
      expect(result.valid).toBe(false);
    });
  });

  describe('validateForLive', () => {
    it('devrait rejeter un step SMS sans destinataire', () => {
      const wf = createValidWorkflow({
        steps: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Envoyer SMS',
            type: 'send_sms',
            config: { body: 'Hello' },
            onError: 'stop',
          },
        ],
      });
      const result = validator.validateForLive(wf);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('destinataire'))).toBe(true);
    });

    it('devrait rejeter un step email sans corps', () => {
      const wf = createValidWorkflow({
        steps: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Envoyer email',
            type: 'send_email',
            config: { to: 'test@test.fr' },
            onError: 'stop',
          },
        ],
      });
      const result = validator.validateForLive(wf);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('corps de message'))).toBe(true);
    });

    it('devrait accepter un step SMS complet', () => {
      const wf = createValidWorkflow({
        steps: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Envoyer SMS',
            type: 'send_sms',
            config: { to: '{{patient.tel}}', body: 'Bonjour {{patient.prenom}}' },
            onError: 'stop',
          },
        ],
      });
      const result = validator.validateForLive(wf);
      expect(result.valid).toBe(true);
    });
  });
});
