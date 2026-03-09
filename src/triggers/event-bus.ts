import { TriggerType, WorkflowEvent } from '../models/types';
import { EventHandler } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('event-bus');

/**
 * EventBus — pub/sub in-memory singleton pour les événements workflow.
 *
 * Tous les triggers (webhook, CRON, manual) publient ici.
 * Le TriggerRegistry s'abonne pour router les events vers les workflows.
 */
export class EventBus {
  private static instance: EventBus | null = null;

  private handlers: Map<TriggerType, Set<EventHandler>> = new Map();
  private globalHandlers: Set<EventHandler> = new Set();
  private deadLetterHandler?: (event: WorkflowEvent, error: string) => Promise<void>;

  private constructor() {}

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /** Reset pour les tests */
  static resetInstance(): void {
    if (EventBus.instance) {
      EventBus.instance.unsubscribeAll();
    }
    EventBus.instance = null;
  }

  /** S'abonner à un type d'event spécifique */
  subscribe(type: TriggerType, handler: EventHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    logger.debug({ type }, 'Handler abonné');
  }

  /** S'abonner à tous les events (monitoring, audit) */
  subscribeAll(handler: EventHandler): void {
    this.globalHandlers.add(handler);
  }

  /** Se désabonner d'un type */
  unsubscribe(type: TriggerType, handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  /** Se désabonner de tous les types */
  unsubscribeAll(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
  }

  /** Définir le handler pour la Dead Letter Queue */
  setDeadLetterHandler(handler: (event: WorkflowEvent, error: string) => Promise<void>): void {
    this.deadLetterHandler = handler;
  }

  /** Publier un event — distribué à tous les handlers du type + globaux */
  async publish(event: WorkflowEvent): Promise<void> {
    logger.info(
      { eventId: event.id, type: event.type, source: event.source, organizationId: event.organizationId },
      'Event publié'
    );

    const typeHandlers = this.handlers.get(event.type) ?? new Set();
    const allHandlers = [...typeHandlers, ...this.globalHandlers];

    if (allHandlers.length === 0) {
      logger.warn({ eventId: event.id, type: event.type }, 'Aucun handler pour cet event');
      if (this.deadLetterHandler) {
        await this.deadLetterHandler(event, 'Aucun handler enregistré');
      }
      return;
    }

    const results = await Promise.allSettled(
      allHandlers.map((handler) => handler(event))
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
        logger.error({ eventId: event.id, error }, 'Erreur dans un handler');

        if (this.deadLetterHandler) {
          await this.deadLetterHandler(event, error).catch((dlqErr) => {
            logger.error({ eventId: event.id, error: dlqErr }, 'Erreur lors de l\'envoi en DLQ');
          });
        }
      }
    }
  }

  /** Nombre de handlers pour un type donné */
  handlerCount(type?: TriggerType): number {
    if (type) {
      return (this.handlers.get(type)?.size ?? 0) + this.globalHandlers.size;
    }
    let total = this.globalHandlers.size;
    for (const handlers of this.handlers.values()) {
      total += handlers.size;
    }
    return total;
  }
}
