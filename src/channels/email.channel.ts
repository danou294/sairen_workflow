import { Channel } from './channel.interface';
import { ChannelMessage, ChannelResult, MessageStatus } from '../models/types';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('channel-email');

/**
 * Canal Email via SendGrid
 * En mode sandbox, les emails sont loggés sans envoi réel
 */
export class EmailChannel implements Channel {
  name = 'email';

  async send(message: ChannelMessage): Promise<ChannelResult> {
    if (config.SANDBOX_MODE) {
      logger.info(
        { to: message.to, subject: message.subject, body: message.body },
        'Email simulé (sandbox)'
      );
      return {
        success: true,
        messageId: `sandbox-email-${Date.now()}`,
        provider: 'sendgrid-sandbox',
      };
    }

    // TODO Sprint 3 : Intégrer le SDK SendGrid
    logger.warn('Client SendGrid non configuré — utiliser SANDBOX_MODE=true pour les tests');
    return {
      success: false,
      provider: 'sendgrid',
      error: 'Client SendGrid non configuré',
    };
  }

  async getStatus(_messageId: string): Promise<MessageStatus> {
    // TODO Sprint 3 : Vérifier le statut via l'API SendGrid
    return 'queued';
  }

  validateConfig(channelConfig: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!channelConfig.to || typeof channelConfig.to !== 'string') {
      errors.push('L\'adresse email du destinataire (to) est requise');
    }

    if (!channelConfig.subject || typeof channelConfig.subject !== 'string') {
      errors.push('Le sujet de l\'email (subject) est requis');
    }

    if (!channelConfig.body || typeof channelConfig.body !== 'string') {
      errors.push('Le corps de l\'email (body) est requis');
    }

    return { valid: errors.length === 0, errors };
  }
}
