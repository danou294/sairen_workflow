import { Channel } from './channel.interface';
import { ChannelMessage, ChannelResult, MessageStatus } from '../models/types';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('channel-sms');

/**
 * Canal SMS via Twilio
 * En mode sandbox, les messages sont loggés sans envoi réel
 */
export class SmsChannel implements Channel {
  name = 'sms';

  async send(message: ChannelMessage): Promise<ChannelResult> {
    if (config.SANDBOX_MODE) {
      logger.info({ to: message.to, body: message.body }, 'SMS simulé (sandbox)');
      return {
        success: true,
        messageId: `sandbox-sms-${Date.now()}`,
        provider: 'twilio-sandbox',
      };
    }

    // TODO Sprint 3 : Intégrer le SDK Twilio
    logger.warn('Client Twilio non configuré — utiliser SANDBOX_MODE=true pour les tests');
    return {
      success: false,
      provider: 'twilio',
      error: 'Client Twilio non configuré',
    };
  }

  async getStatus(_messageId: string): Promise<MessageStatus> {
    // TODO Sprint 3 : Vérifier le statut via l'API Twilio
    return 'queued';
  }

  validateConfig(channelConfig: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!channelConfig.to || typeof channelConfig.to !== 'string') {
      errors.push('Le numéro de téléphone du destinataire (to) est requis');
    }

    if (!channelConfig.body || typeof channelConfig.body !== 'string') {
      errors.push('Le corps du message (body) est requis');
    }

    return { valid: errors.length === 0, errors };
  }
}
