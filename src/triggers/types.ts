import { WorkflowEvent, TriggerType } from '../models/types';

/** Handler appelé quand un event est publié sur l'EventBus */
export type EventHandler = (event: WorkflowEvent) => Promise<void>;

/** Enregistrement d'un trigger pour un workflow */
export interface TriggerRegistration {
  workflowId: string;
  triggerType: TriggerType;
  organizationId: string;
  handler: EventHandler;
}

/** Entrée dans la Dead Letter Queue */
export interface DeadLetterEntry {
  id: string;
  event: WorkflowEvent;
  error: string;
  failedAt: string;
  retryCount: number;
  source: string;
}
