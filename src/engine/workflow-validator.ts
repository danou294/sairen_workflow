import { WorkflowDefinition, Step, Condition, VALID_TRANSITIONS } from '../models/types';
import { createWorkflowSchema } from '../models/schemas';
import { createLogger } from '../utils/logger';

const logger = createLogger('workflow-validator');

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Valide un workflow complet avant enregistrement ou changement de statut
 */
export class WorkflowValidator {
  /** Validation structurelle complète d'un workflow */
  validate(workflow: WorkflowDefinition): ValidationResult {
    const errors: ValidationError[] = [];

    // 1. Validation Zod de la structure
    const zodResult = createWorkflowSchema.safeParse({
      name: workflow.name,
      description: workflow.description,
      trigger: workflow.trigger,
      steps: workflow.steps,
      variables: workflow.variables,
      tags: workflow.tags,
    });

    if (!zodResult.success) {
      for (const issue of zodResult.error.issues) {
        errors.push({
          field: issue.path.join('.'),
          message: issue.message,
        });
      }
    }

    // 2. Validations métier
    errors.push(...this.validateSteps(workflow.steps));
    errors.push(...this.validateConditions(workflow.steps));
    errors.push(...this.validateStepIds(workflow.steps));

    if (errors.length > 0) {
      logger.debug({ workflowId: workflow.id, errorCount: errors.length }, 'Validation échouée');
    }

    return { valid: errors.length === 0, errors };
  }

  /** Valide qu'une transition de statut est autorisée */
  validateTransition(
    currentStatus: WorkflowDefinition['status'],
    newStatus: WorkflowDefinition['status']
  ): ValidationResult {
    const validTargets = VALID_TRANSITIONS[currentStatus];

    if (!validTargets.includes(newStatus)) {
      return {
        valid: false,
        errors: [
          {
            field: 'status',
            message: `Transition invalide : ${currentStatus} → ${newStatus}. Transitions autorisées : ${validTargets.join(', ')}`,
          },
        ],
      };
    }

    return { valid: true, errors: [] };
  }

  /** Valide les prérequis pour passer en TESTING */
  validateForTesting(workflow: WorkflowDefinition): ValidationResult {
    const errors: ValidationError[] = [];
    const baseValidation = this.validate(workflow);
    errors.push(...baseValidation.errors);

    if (workflow.steps.length === 0) {
      errors.push({
        field: 'steps',
        message: 'Au moins un step est requis pour passer en mode test',
      });
    }

    if (!workflow.trigger || !workflow.trigger.type) {
      errors.push({
        field: 'trigger',
        message: 'Un déclencheur doit être configuré pour passer en mode test',
      });
    }

    return { valid: errors.length === 0, errors };
  }

  /** Valide les prérequis pour passer en LIVE */
  validateForLive(workflow: WorkflowDefinition): ValidationResult {
    const errors: ValidationError[] = [];
    const testingValidation = this.validateForTesting(workflow);
    errors.push(...testingValidation.errors);

    // Vérifier que les steps de communication ont une config minimale
    const channelSteps = workflow.steps.filter((s) =>
      ['send_sms', 'send_email', 'send_whatsapp'].includes(s.type)
    );

    for (const step of channelSteps) {
      if (!step.config.to) {
        errors.push({
          field: `steps.${step.id}.config.to`,
          message: `Le step "${step.name}" n'a pas de destinataire configuré`,
        });
      }
      if (!step.config.body) {
        errors.push({
          field: `steps.${step.id}.config.body`,
          message: `Le step "${step.name}" n'a pas de corps de message configuré`,
        });
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // --- Validations internes ---

  /** Vérifie que les IDs des steps sont uniques */
  private validateStepIds(steps: Step[]): ValidationError[] {
    const errors: ValidationError[] = [];
    const ids = new Set<string>();

    for (const step of steps) {
      if (ids.has(step.id)) {
        errors.push({
          field: `steps.${step.id}`,
          message: `ID de step dupliqué : "${step.id}"`,
        });
      }
      ids.add(step.id);
    }

    // Vérifier les références "next"
    for (const step of steps) {
      if (step.next && !ids.has(step.next)) {
        errors.push({
          field: `steps.${step.id}.next`,
          message: `Le step "${step.name}" référence un step inexistant : "${step.next}"`,
        });
      }
    }

    return errors;
  }

  /** Vérifie la cohérence des steps */
  private validateSteps(steps: Step[]): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const step of steps) {
      // Un step retry doit avoir une retryConfig
      if (step.onError === 'retry' && !step.retryConfig) {
        errors.push({
          field: `steps.${step.id}.retryConfig`,
          message: `Le step "${step.name}" a onError="retry" mais pas de retryConfig`,
        });
      }

      // Vérifier la config minimale selon le type
      if (step.type === 'delay' && !step.config.duration) {
        errors.push({
          field: `steps.${step.id}.config.duration`,
          message: `Le step delay "${step.name}" n'a pas de durée configurée`,
        });
      }
    }

    return errors;
  }

  /** Vérifie les conditions */
  private validateConditions(steps: Step[]): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const step of steps) {
      if (!step.condition) continue;

      if (!step.condition.field || step.condition.field.trim() === '') {
        errors.push({
          field: `steps.${step.id}.condition.field`,
          message: `Le step "${step.name}" a une condition sans champ`,
        });
      }

      // Les opérateurs exists/not_exists n'ont pas besoin de value
      const noValueOperators = ['exists', 'not_exists'];
      if (
        !noValueOperators.includes(step.condition.operator) &&
        step.condition.value === undefined
      ) {
        errors.push({
          field: `steps.${step.id}.condition.value`,
          message: `Le step "${step.name}" a une condition "${step.condition.operator}" sans valeur`,
        });
      }
    }

    return errors;
  }
}
