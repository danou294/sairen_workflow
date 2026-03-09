import { describe, it, expect } from 'vitest';
import { evaluateCondition, evaluateConditions } from '../../engine/condition-evaluator';

describe('ConditionEvaluator', () => {
  describe('equals / not_equals', () => {
    it('equals devrait matcher des valeurs identiques', () => {
      expect(evaluateCondition({ field: 'status', operator: 'equals', value: 'confirmed' }, { status: 'confirmed' })).toBe(true);
    });

    it('equals devrait rejeter des valeurs différentes', () => {
      expect(evaluateCondition({ field: 'status', operator: 'equals', value: 'confirmed' }, { status: 'cancelled' })).toBe(false);
    });

    it('not_equals devrait matcher des valeurs différentes', () => {
      expect(evaluateCondition({ field: 'status', operator: 'not_equals', value: 'cancelled' }, { status: 'confirmed' })).toBe(true);
    });
  });

  describe('contains / not_contains', () => {
    it('contains devrait trouver une sous-chaîne', () => {
      expect(evaluateCondition({ field: 'email', operator: 'contains', value: '@gmail' }, { email: 'test@gmail.com' })).toBe(true);
    });

    it('not_contains devrait rejeter une sous-chaîne présente', () => {
      expect(evaluateCondition({ field: 'email', operator: 'not_contains', value: '@gmail' }, { email: 'test@gmail.com' })).toBe(false);
    });
  });

  describe('greater_than / less_than', () => {
    it('greater_than devrait comparer correctement', () => {
      expect(evaluateCondition({ field: 'montant', operator: 'greater_than', value: 100 }, { montant: 150 })).toBe(true);
      expect(evaluateCondition({ field: 'montant', operator: 'greater_than', value: 100 }, { montant: 50 })).toBe(false);
    });

    it('less_than devrait comparer correctement', () => {
      expect(evaluateCondition({ field: 'montant', operator: 'less_than', value: 100 }, { montant: 50 })).toBe(true);
    });
  });

  describe('exists / not_exists', () => {
    it('exists devrait détecter un champ présent', () => {
      expect(evaluateCondition({ field: 'phone', operator: 'exists' }, { phone: '0612345678' })).toBe(true);
    });

    it('exists devrait rejeter un champ absent', () => {
      expect(evaluateCondition({ field: 'phone', operator: 'exists' }, {})).toBe(false);
    });

    it('not_exists devrait détecter un champ absent', () => {
      expect(evaluateCondition({ field: 'phone', operator: 'not_exists' }, {})).toBe(true);
    });
  });

  describe('in / not_in', () => {
    it('in devrait matcher une valeur dans la liste', () => {
      expect(evaluateCondition({ field: 'source', operator: 'in', value: ['doctolib', 'web'] }, { source: 'doctolib' })).toBe(true);
    });

    it('in devrait rejeter une valeur hors liste', () => {
      expect(evaluateCondition({ field: 'source', operator: 'in', value: ['doctolib', 'web'] }, { source: 'phone' })).toBe(false);
    });
  });

  describe('matches (regex)', () => {
    it('devrait matcher un pattern regex', () => {
      expect(evaluateCondition({ field: 'phone', operator: 'matches', value: '^06' }, { phone: '0612345678' })).toBe(true);
    });

    it('devrait rejeter un pattern qui ne matche pas', () => {
      expect(evaluateCondition({ field: 'phone', operator: 'matches', value: '^06' }, { phone: '0112345678' })).toBe(false);
    });
  });

  describe('valeurs imbriquées', () => {
    it('devrait accéder à des valeurs nested', () => {
      const context = { patient: { prenom: 'Jean', age: 45 } };
      expect(evaluateCondition({ field: 'patient.prenom', operator: 'equals', value: 'Jean' }, context)).toBe(true);
      expect(evaluateCondition({ field: 'patient.age', operator: 'greater_than', value: 30 }, context)).toBe(true);
    });
  });

  describe('evaluateConditions (groupe)', () => {
    it('devrait évaluer un groupe AND', () => {
      const conditions = [
        { field: 'status', operator: 'equals' as const, value: 'confirmed' },
        { field: 'montant', operator: 'greater_than' as const, value: 50, logic: 'AND' as const },
      ];
      expect(evaluateConditions(conditions, { status: 'confirmed', montant: 100 })).toBe(true);
      expect(evaluateConditions(conditions, { status: 'confirmed', montant: 30 })).toBe(false);
    });

    it('devrait évaluer un groupe OR', () => {
      const conditions = [
        { field: 'source', operator: 'equals' as const, value: 'doctolib' },
        { field: 'source', operator: 'equals' as const, value: 'web', logic: 'OR' as const },
      ];
      expect(evaluateConditions(conditions, { source: 'web' })).toBe(true);
      expect(evaluateConditions(conditions, { source: 'phone' })).toBe(false);
    });

    it('devrait retourner true pour un groupe vide', () => {
      expect(evaluateConditions([], {})).toBe(true);
    });
  });
});
