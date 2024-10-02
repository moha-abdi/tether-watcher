import axios from "axios";
import { logger } from "./logger";
import { generateSignature } from "./generateSignature";

export async function sendWebhook(url: string, data: any) {
  try {
    const payload = JSON.stringify(data);
    const signature = generateSignature(payload);

    await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
      },
    });
    console.info(`Webhook sent successfully to ${url}`);
  } catch (error) {
    console.error(`Failed to send webhook to ${url}:`, error);
  }
}
