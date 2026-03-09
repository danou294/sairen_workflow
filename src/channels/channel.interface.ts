import { ChannelMessage, ChannelResult, MessageStatus } from '../models/types';
import { createLogger } from '../utils/logger';

const logger = createLogger('channel-registry');

/**
 * Interface commune pour tous les canaux de communication
 */
export interface Channel {
  name: string;
  send(message: ChannelMessage): Promise<ChannelResult>;
  getStatus(messageId: string): Promise<MessageStatus>;
  validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] };
}

/**
 * Registre central des canaux disponibles
 */
export class ChannelRegistry {
  private channels: Map<string, Channel> = new Map();

  register(channel: Channel): void {
    this.channels.set(channel.name, channel);
    logger.info({ channel: channel.name }, 'Canal enregistré');
  }

  get(name: string): Channel | undefined {
    return this.channels.get(name);
  }

  list(): string[] {
    return Array.from(this.channels.keys());
  }

  has(name: string): boolean {
    return this.channels.has(name);
  }
}
