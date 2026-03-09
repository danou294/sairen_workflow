import { WorkflowDefinition, WorkflowEvent, TriggerType } from '../models/types';
import { evaluateConditions } from '../engine/condition-evaluator';
import { EventBus } from './event-bus';
import { WorkflowEngine } from '../engine/workflow-engine';
import { EventHandler, TriggerRegistration } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('trigger-registry');

/**
 * TriggerRegistry — route les événements de l'EventBus vers les workflows correspondants.
 *
 * Responsabilités :
 * - Enregistre un handler sur l'EventBus pour chaque workflow actif
 * - Filtre par organizationId (multi-tenancy)
 * - Évalue les filtres du trigger avant l'exécution
 * - Supporte le fan-out (plusieurs workflows pour le même type d'event)
 */
export class TriggerRegistry {
  private registrations: Map<string, TriggerRegistration> = new Map();

  constructor(
    private eventBus: EventBus,
    private engine: WorkflowEngine
  ) {}

  /** Enregistre un workflow et s'abonne sur l'EventBus */
  registerWorkflow(workflow: WorkflowDefinition): void {
    // Éviter les doublons
    if (this.registrations.has(workflow.id)) {
      this.unregisterWorkflow(workflow.id);
    }

    const handler: EventHandler = async (event: WorkflowEvent) => {
      // Multi-tenancy : vérifier l'organizationId
      if (event.organizationId !== workflow.metadata.organizationId) {
        return;
      }

      // Évaluer les filtres du trigger
      if (workflow.trigger.filters && workflow.trigger.filters.length > 0) {
        const filtersPass = evaluateConditions(
          workflow.trigger.filters,
          event.payload
        );
        if (!filtersPass) {
          logger.debug(
            { workflowId: workflow.id, eventId: event.id },
            'Filtres du trigger non satisfaits, exécution ignorée'
          );
          return;
        }
      }

      logger.info(
        { workflowId: workflow.id, eventId: event.id, type: event.type },
        'Event routé vers le workflow'
      );

      try {
        await this.engine.execute(workflow.id, event.payload as Record<string, unknown>, {
          isSandbox: workflow.status === 'TESTING',
        });
      } catch (error) {
        logger.error(
          { workflowId: workflow.id, eventId: event.id, error: error instanceof Error ? error.message : String(error) },
          'Erreur lors de l\'exécution du workflow déclenché'
        );
      }
    };

    const registration: TriggerRegistration = {
      workflowId: workflow.id,
      triggerType: workflow.trigger.type,
      organizationId: workflow.metadata.organizationId,
      handler,
    };

    this.registrations.set(workflow.id, registration);
    this.eventBus.subscribe(workflow.trigger.type, handler);

    logger.info(
      { workflowId: workflow.id, triggerType: workflow.trigger.type },
      'Workflow enregistré dans le TriggerRegistry'
    );
  }

  /** Désenregistre un workflow de l'EventBus */
  unregisterWorkflow(workflowId: string): void {
    const registration = this.registrations.get(workflowId);
    if (registration) {
      this.eventBus.unsubscribe(registration.triggerType, registration.handler);
      this.registrations.delete(workflowId);
      logger.info({ workflowId }, 'Workflow désenregistré du TriggerRegistry');
    }
  }

  /** Synchronise tous les workflows actifs (LIVE) depuis le moteur */
  syncActiveWorkflows(): void {
    const workflows = this.engine.listWorkflows();
    let count = 0;

    for (const wf of workflows) {
      if (wf.status === 'LIVE' || wf.status === 'TESTING') {
        this.registerWorkflow(wf);
        count++;
      }
    }

    logger.info({ count }, 'Workflows actifs synchronisés dans le TriggerRegistry');
  }

  /** Liste les workflows enregistrés */
  getRegisteredWorkflows(): Map<string, TriggerType> {
    const result = new Map<string, TriggerType>();
    for (const [id, reg] of this.registrations) {
      result.set(id, reg.triggerType);
    }
    return result;
  }

  /** Nombre de workflows enregistrés */
  get size(): number {
    return this.registrations.size;
  }

  /** Nettoie tout */
  clear(): void {
    for (const workflowId of this.registrations.keys()) {
      this.unregisterWorkflow(workflowId);
    }
  }
}
