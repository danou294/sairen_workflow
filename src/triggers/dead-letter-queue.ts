import { randomUUID } from 'crypto';
import { WorkflowEvent } from '../models/types';
import { DeadLetterEntry } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('dead-letter-queue');

/**
 * Dead Letter Queue — stocke les events qui n'ont pas pu être traités.
 *
 * V1 : in-memory (comme le WorkflowEngine en mode test).
 * V2 : backed par BullMQ Queue pour la persistance.
 */
export class DeadLetterQueue {
  private entries: DeadLetterEntry[] = [];
  private readonly maxSize: number;

  constructor(options: { maxSize?: number } = {}) {
    this.maxSize = options.maxSize ?? 1000;
  }

  /** Ajoute un event en DLQ */
  async add(event: WorkflowEvent, error: string, source?: string): Promise<string> {
    const entry: DeadLetterEntry = {
      id: randomUUID(),
      event,
      error,
      failedAt: new Date().toISOString(),
      retryCount: 0,
      source: source ?? 'event-bus',
    };

    this.entries.push(entry);

    // Buffer circulaire
    if (this.entries.length > this.maxSize) {
      this.entries.shift();
    }

    logger.warn(
      { dlqEntryId: entry.id, eventId: event.id, error },
      'Event ajouté à la Dead Letter Queue'
    );

    return entry.id;
  }

  /** Récupère les entrées (plus récentes en premier) */
  getEntries(limit?: number): DeadLetterEntry[] {
    const sorted = [...this.entries].reverse();
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /** Récupère une entrée par ID */
  findById(id: string): DeadLetterEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Marque une entrée comme retentée */
  markRetried(id: string): DeadLetterEntry | undefined {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.retryCount++;
    }
    return entry;
  }

  /** Supprime une entrée */
  remove(id: string): boolean {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index !== -1) {
      this.entries.splice(index, 1);
      return true;
    }
    return false;
  }

  /** Purge toute la DLQ */
  purge(): number {
    const count = this.entries.length;
    this.entries = [];
    logger.info({ count }, 'Dead Letter Queue purgée');
    return count;
  }

  /** Nombre d'entrées */
  get size(): number {
    return this.entries.length;
  }
}
