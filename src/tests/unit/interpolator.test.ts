import { describe, it, expect } from 'vitest';
import { interpolate } from '../../engine/interpolator';

describe('Interpolator', () => {
  describe('variables simples', () => {
    it('devrait remplacer une variable simple', () => {
      expect(interpolate('Bonjour {{prenom}}', { prenom: 'Jean' })).toBe('Bonjour Jean');
    });

    it('devrait remplacer plusieurs variables', () => {
      expect(
        interpolate('{{prenom}} {{nom}}', { prenom: 'Jean', nom: 'Dupont' })
      ).toBe('Jean Dupont');
    });

    it('devrait retourner une chaîne vide pour une variable inexistante', () => {
      expect(interpolate('Bonjour {{prenom}}', {})).toBe('Bonjour ');
    });
  });

  describe('variables imbriquées', () => {
    it('devrait résoudre un chemin pointé', () => {
      const ctx = { patient: { prenom: 'Marie', nom: 'Martin' } };
      expect(interpolate('Bonjour {{patient.prenom}} {{patient.nom}}', ctx)).toBe(
        'Bonjour Marie Martin'
      );
    });

    it('devrait gérer des chemins profonds', () => {
      const ctx = { rdv: { medecin: { specialite: 'Cardiologue' } } };
      expect(interpolate('Spécialité : {{rdv.medecin.specialite}}', ctx)).toBe(
        'Spécialité : Cardiologue'
      );
    });
  });

  describe('pipes', () => {
    it('uppercase devrait mettre en majuscules', () => {
      expect(interpolate('{{nom | uppercase}}', { nom: 'dupont' })).toBe('DUPONT');
    });

    it('lowercase devrait mettre en minuscules', () => {
      expect(interpolate('{{nom | lowercase}}', { nom: 'DUPONT' })).toBe('dupont');
    });

    it('capitalize devrait capitaliser', () => {
      expect(interpolate('{{nom | capitalize}}', { nom: 'dupont' })).toBe('Dupont');
    });

    it('default devrait fournir une valeur par défaut', () => {
      expect(interpolate("{{prenom | default:'Patient'}}", {})).toBe('Patient');
      expect(interpolate("{{prenom | default:'Patient'}}", { prenom: 'Jean' })).toBe('Jean');
    });

    it("truncate devrait limiter la longueur", () => {
      expect(interpolate("{{texte | truncate:'10'}}", { texte: 'Un texte très long' })).toBe(
        'Un texte t...'
      );
    });

    it('devrait chaîner plusieurs pipes', () => {
      expect(interpolate('{{nom | uppercase | truncate:\'3\'}}', { nom: 'dupont' })).toBe(
        'DUP...'
      );
    });
  });

  describe('format (dates)', () => {
    it('devrait formater une date DD/MM/YYYY', () => {
      const result = interpolate(
        "{{date | format:'DD/MM/YYYY'}}",
        { date: '2026-03-15T10:30:00Z' }
      );
      expect(result).toMatch(/15\/03\/2026/);
    });
  });

  describe('texte sans variables', () => {
    it('devrait retourner le texte tel quel', () => {
      expect(interpolate('Pas de variable ici', {})).toBe('Pas de variable ici');
    });
  });
});
