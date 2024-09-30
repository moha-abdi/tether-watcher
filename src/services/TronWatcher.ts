import { TronWeb } from "tronweb";
import BigNumber from "bignumber.js";
import { sendWebhook } from "../utils/webhook";
import { logger } from "../utils/logger";

interface WatchedTransaction {
  id: string;
  fromAddress: string;
  amount: string;
  webhookUrl: string;
  expiresAt: number;
}

interface ProcessedEvent {
  transactionHash: string;
  eventIndex: number;
  processedAt: number;
}

export class TronWatcher {
  private tronWeb: TronWeb;
  private tokenAddress: string;
  private watchedTransactions: Map<string, WatchedTransaction> = new Map();
  private processedEvents: Map<string, ProcessedEvent> = new Map();
  private lastProcessedBlock: number = 0;
  private isWatching: boolean = false;

  constructor() {
    this.tronWeb = new TronWeb({
      fullHost: process.env.TRON_FULL_HOST || "https://api.trongrid.io",
      headers: { "TRON-PRO-API-KEY": process.env.TRON_PRO_API_KEY! },
    });
    this.tokenAddress = process.env.USDT_DEPOSIT_ADDRESS!;
  }

  async startWatchProcess() {
    if (this.isWatching) {
      logger.warn("Watch process is already running");
      return;
    }
    this.isWatching = true;
    logger.info("Starting watch process...");
    this.watchTransactions();
  }

  async addTransaction(
    id: string,
    fromAddress: string,
    amount: number,
    webhookUrl: string,
  ) {
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes from now
    const transaction: WatchedTransaction = {
      id,
      fromAddress,
      amount: new BigNumber(amount).multipliedBy(1e6).toString(),
      webhookUrl,
      expiresAt,
    };
    this.watchedTransactions.set(id, transaction);
    logger.info(`Added transaction to watch list: ${id}`);
  }

  async removeTransaction(id: string) {
    this.watchedTransactions.delete(id);
    logger.info(`Removed transaction from watch list: ${id}`);
  }

  private async watchTransactions() {
    while (this.isWatching) {
      try {
        const events = await this.tronWeb.event.getEventsByContractAddress(
          process.env.USDT_CONTRACT_ADDRESS!,
          {
            onlyConfirmed: true,
            eventName: "Transfer",
          },
        );

        if (!events.success || !events.data || events.data.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds before next attempt
          continue;
        }

        for (const event of events.data) {
          await this.processEvent(event);
        }

        this.lastProcessedBlock =
          events.data[events.data.length - 1].block_number;
        await this.cleanupExpiredTransactions();
        await this.cleanupOldProcessedEvents();
      } catch (error) {
        logger.error("Error watching transactions:", error);
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds before retrying
      }
    }
  }

  private async processEvent(event: any) {
    const eventKey = `${event.transaction_id}:${event.event_index}`;
    if (this.processedEvents.has(eventKey)) {
      return; // Skip already processed events
    }

    const from = this.tronWeb.address.fromHex(event.result.from);
    const to = this.tronWeb.address.fromHex(event.result.to);
    const value = new BigNumber(event.result.value);

    for (const [id, tx] of this.watchedTransactions) {
      if (
        from === tx.fromAddress &&
        to === this.tokenAddress &&
        value.toString() === tx.amount
      ) {
        await sendWebhook(tx.webhookUrl, {
          id: tx.id,
          status: "COMPLETED",
          transactionHash: event.transaction_id,
          blockNumber: event.block_number,
        });
        this.watchedTransactions.delete(id);
        logger.info(`Transaction completed: ${id}`);
        break;
      }
    }

    this.processedEvents.set(eventKey, {
      transactionHash: event.transaction_id,
      eventIndex: event.event_index,
      processedAt: Date.now(),
    });
  }

  private async cleanupExpiredTransactions() {
    const currentTime = Date.now();
    for (const [id, tx] of this.watchedTransactions) {
      if (currentTime > tx.expiresAt) {
        await sendWebhook(tx.webhookUrl, { id: tx.id, status: "EXPIRED" });
        this.watchedTransactions.delete(id);
        logger.info(`Transaction expired: ${id}`);
      }
    }
  }

  private async cleanupOldProcessedEvents() {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
    for (const [key, event] of this.processedEvents) {
      if (event.processedAt < oneDayAgo) {
        this.processedEvents.delete(key);
      }
    }
  }

  stopWatchProcess() {
    this.isWatching = false;
    logger.info("Stopping watch process...");
  }

  getWatchedTransactionsCount(): number {
    return this.watchedTransactions.size;
  }

  getProcessedEventsCount(): number {
    return this.processedEvents.size;
  }

  getLastProcessedBlock(): number {
    return this.lastProcessedBlock;
  }
}
