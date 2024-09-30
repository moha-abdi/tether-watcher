import axios from 'axios';
import { logger } from './logger';

export async function sendWebhook(url: string, data: any) {
  try {
    await axios.post(url, data);
    logger.info(`Webhook sent successfully to ${url}`);
  } catch (error) {
    logger.error(`Failed to send webhook to ${url}:`, error);
  }
}

