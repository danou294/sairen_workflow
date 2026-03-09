/** Erreur de base pour le workflow engine */
export class WorkflowError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
  }
}

/** Workflow introuvable */
export class WorkflowNotFoundError extends WorkflowError {
  constructor(workflowId: string) {
    super(`Workflow "${workflowId}" introuvable`, 'WORKFLOW_NOT_FOUND');
    this.name = 'WorkflowNotFoundError';
  }
}

/** Transition de lifecycle invalide */
export class InvalidTransitionError extends WorkflowError {
  constructor(from: string, to: string, validTargets: string[]) {
    super(
      `Transition invalide : ${from} → ${to}. Transitions autorisées : ${validTargets.join(', ')}`,
      'INVALID_TRANSITION'
    );
    this.name = 'InvalidTransitionError';
  }
}

/** Validation échouée (structure, prérequis) */
export class ValidationError extends WorkflowError {
  readonly details: { field: string; message: string }[];

  constructor(message: string, details: { field: string; message: string }[]) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.details = details;
  }
}

/** Statut d'exécution invalide */
export class ExecutionNotAllowedError extends WorkflowError {
  constructor(workflowId: string, status: string) {
    super(
      `Impossible d'exécuter le workflow "${workflowId}" en statut ${status}`,
      'EXECUTION_NOT_ALLOWED'
    );
    this.name = 'ExecutionNotAllowedError';
  }
}

/** Action inconnue */
export class UnknownActionError extends WorkflowError {
  constructor(actionType: string) {
    super(`Type d'action inconnu : ${actionType}`, 'UNKNOWN_ACTION');
    this.name = 'UnknownActionError';
  }
}

/** Mode persistant non activé */
export class PersistenceError extends WorkflowError {
  constructor() {
    super('Mode persistant non activé', 'PERSISTENCE_NOT_ENABLED');
    this.name = 'PersistenceError';
  }
}

/** Erreur liée aux triggers */
export class TriggerError extends WorkflowError {
  constructor(message: string) {
    super(message, 'TRIGGER_ERROR');
    this.name = 'TriggerError';
  }
}
