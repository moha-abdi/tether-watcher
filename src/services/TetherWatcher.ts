import { TronWeb } from "tronweb";
import { ethers } from "ethers";
import BigNumber from "bignumber.js";
import { sendWebhook } from "../utils/webhook";

export enum Network {
  TRC20 = "TRC20",
  BEP20 = "BEP20",
}

export enum TransactionStatus {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  EXPIRED = "EXPIRED",
}

interface NetworkConfig {
  enabled: boolean;
  isTestnet: boolean;
  rpcUrl: string;
  contractAddress: string;
  confirmations: number;
  decimals: number;
  minAmount?: string;
  maxAmount?: string;
  blockTime: number;
  retryInterval: number;
}

interface WatchedTransaction {
  id: string;
  network: Network;
  fromAddress: string;
  expectedRecipientAddress: string;
  amount: string;
  webhookUrl: string;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
  status: TransactionStatus;
  lastChecked: number;
}

interface ProcessedEvent {
  transactionHash: string;
  eventIndex: number;
  processedAt: number;
  blockNumber: number;
  confirmations: number;
  network: Network;
}

interface TransactionUpdate {
  id: string;
  network: Network;
  status: TransactionStatus;
  transactionHash?: string;
  blockNumber?: number;
  confirmations?: number;
  isTestnet: boolean;
  error?: string;
}

const USDT_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        name: "from",
        type: "address",
      },
      {
        indexed: true,
        name: "to",
        type: "address",
      },
      {
        indexed: false,
        name: "value",
        type: "uint256",
      },
    ],
    name: "Transfer",
    type: "event",
  },
];

export class TetherWatcher {
  // @ts-ignore TronWeb is initialized not in the constructor but rather in initializeClients method
  private tronWeb: TronWeb;
  private providers: Map<Network, ethers.Provider> = new Map();
  private contracts: Map<Network, ethers.Contract> = new Map();
  private networkConfigs: Map<Network, NetworkConfig> = new Map();
  private watchedTransactions: Map<string, WatchedTransaction> = new Map();
  private processedEvents: Map<string, ProcessedEvent> = new Map();
  private lastProcessedBlocks: Record<Network, bigint> = {
    [Network.TRC20]: BigInt(0),
    [Network.BEP20]: BigInt(0),
  };
  private pendingConfirmations = new Map<
    string,
    {
      network: Network;
      transactionHash: string;
      blockNumber: number;
    }
  >();
  private processingTransactions: Set<string> = new Set();
  private isWatching: boolean = false;
  public readonly isTestMode: boolean;
  private maintenanceInterval?: NodeJS.Timeout;

  constructor(isTestMode: boolean = false) {
    this.isTestMode = isTestMode;
    this.initializeNetworkConfigs();
    this.initializeClients();
  }

  private initializeNetworkConfigs() {
    this.networkConfigs.set(Network.TRC20, {
      enabled: true,
      isTestnet: this.isTestMode,
      rpcUrl: this.isTestMode
        ? process.env.TRON_TESTNET_URL!
        : process.env.TRON_MAINNET_URL!,
      contractAddress: this.isTestMode
        ? process.env.TRON_TESTNET_CONTRACT!
        : process.env.TRON_MAINNET_CONTRACT!,
      confirmations: 20,
      decimals: 6,
      minAmount: "1000000",
      maxAmount: "1000000000000",
      blockTime: 3,
      retryInterval: 10000,
    });

    this.networkConfigs.set(Network.BEP20, {
      enabled: true,
      isTestnet: this.isTestMode,
      rpcUrl: this.isTestMode
        ? process.env.BSC_TESTNET_URL!
        : process.env.BSC_MAINNET_URL!,
      contractAddress: this.isTestMode
        ? process.env.BSC_TESTNET_CONTRACT!
        : process.env.BSC_MAINNET_CONTRACT!,
      confirmations: 12,
      decimals: 18,
      minAmount: this.isTestMode
        ? BigInt(Math.floor((0.1 / 675.54) * 10 ** 18)).toString() // Convert 0.1 USD to BNB in wei
        : "10000000000000000", // 0.01 BNB in wei
      maxAmount: "1000000000000000000000000",
      blockTime: 3,
      retryInterval: 10000,
    });
  }

  private initializeClients() {
    try {
      // Initialize TRON
      const tronConfig = this.networkConfigs.get(Network.TRC20)!;
      this.tronWeb = new TronWeb({
        fullHost: tronConfig.rpcUrl,
        headers: { "TRON-PRO-API-KEY": process.env.TRON_PRO_API_KEY! },
      });

      // Initialize BSC with ethers
      const bscConfig = this.networkConfigs.get(Network.BEP20)!;
      const bscProvider = new ethers.JsonRpcProvider(bscConfig.rpcUrl);
      this.providers.set(Network.BEP20, bscProvider);

      const bscContract = new ethers.Contract(
        bscConfig.contractAddress,
        USDT_ABI,
        bscProvider,
      );
      this.contracts.set(Network.BEP20, bscContract);

      console.info("Network clients initialized successfully");
    } catch (error) {
      console.error("Failed to initialize network clients:", error);
      throw error;
    }
  }

  async startWatchProcess() {
    if (this.isWatching) {
      console.warn("Watch process is already running");
      return;
    }

    try {
      this.isWatching = true;
      console.info(
        `Starting watch process in ${this.isTestMode ? "testnet" : "mainnet"} mode...`,
      );

      for (const network of this.networkConfigs.keys()) {
        if (this.networkConfigs.get(network)!.enabled) {
          if (network === Network.TRC20) {
            this.watchTronTransactions();
          } else if (network === Network.BEP20) {
            this.watchBscTransactions();
          }
        }
      }

      this.startMaintenanceProcess();
    } catch (error) {
      this.isWatching = false;
      console.error("Failed to start watch process:", error);
      throw error;
    }
  }

  private startMaintenanceProcess() {
    this.maintenanceInterval = setInterval(async () => {
      await this.cleanupExpiredTransactions();
      await this.cleanupOldProcessedEvents();
      await this.retryFailedTransactions();
    }, 60000);
  }

  async validateNetwork(network: Network): Promise<boolean> {
    const config = this.networkConfigs.get(network);
    if (!config) {
      throw new Error(`Unsupported network: ${network}`);
    }
    if (!config.enabled) {
      throw new Error(`Network ${network} is currently disabled`);
    }
    return true;
  }

  async validateAmount(network: Network, amount: string): Promise<boolean> {
    const config = this.networkConfigs.get(network)!;
    const amountBN = new BigNumber(amount);

    if (config.minAmount && amountBN.lt(config.minAmount)) {
      throw new Error(
        `Amount ${amount} below minimum ${config.minAmount} for ${network}`,
      );
    }
    if (config.maxAmount && amountBN.gt(config.maxAmount)) {
      throw new Error(
        `Amount ${amount} above maximum ${config.maxAmount} for ${network}`,
      );
    }
    return true;
  }

  async addTransaction(
    id: string,
    network: Network,
    fromAddress: string,
    expectedRecipientAddress: string,
    amount: number,
    webhookUrl: string,
  ) {
    if (this.watchedTransactions.has(id)) {
      throw new Error(`Transaction with ID ${id} already exists`);
    }

    await this.validateNetwork(network);
    const config = this.networkConfigs.get(network)!;
    const amountInSmallestUnit = new BigNumber(amount)
      .multipliedBy(new BigNumber(10).pow(config.decimals))
      .toString();

    await this.validateAmount(network, amountInSmallestUnit);

    const transaction: WatchedTransaction = {
      id,
      network,
      fromAddress,
      expectedRecipientAddress,
      amount: amountInSmallestUnit,
      webhookUrl,
      expiresAt: Date.now() + 5 * 60 * 1000,
      attempts: 0,
      maxAttempts: 3,
      status: TransactionStatus.PENDING,
      lastChecked: Date.now(),
    };

    this.watchedTransactions.set(id, transaction);
    console.info(
      `Added ${network} transaction to watch list: ${id} (${
        this.isTestMode ? "testnet" : "mainnet"
      })`,
    );
  }

  private async watchTronTransactions() {
    while (this.isWatching) {
      try {
        await this.checkPendingConfirmations();
        const config = this.networkConfigs.get(Network.TRC20)!;
        const events = await this.tronWeb.event.getEventsByContractAddress(
          config.contractAddress,
          {
            onlyConfirmed: true,
            eventName: "Transfer",
          },
        );

        if (events.success && events.data && events.data?.length > 0) {
          const currentBlock = await this.tronWeb.trx.getCurrentBlock();
          for (const event of events.data) {
            await this.processTronEvent(
              event,
              currentBlock.block_header.raw_data.number,
            );
          }
          this.lastProcessedBlocks[Network.TRC20] = BigInt(
            currentBlock.block_header.raw_data.number,
          );
        }

        await new Promise((resolve) =>
          setTimeout(resolve, config.retryInterval),
        );
      } catch (error) {
        console.error("Error watching TRON transactions:", error);
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
    }
  }

  private async watchBscTransactions() {
    while (this.isWatching) {
      try {
        await this.checkPendingConfirmations();
        const config = this.networkConfigs.get(Network.BEP20)!;
        const provider = this.providers.get(Network.BEP20)!;
        const contract = this.contracts.get(Network.BEP20)!;

        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(
          currentBlock - 100,
          Number(this.lastProcessedBlocks[Network.BEP20] ?? currentBlock - 100),
        );

        const filter = contract.filters.Transfer();
        const events = await contract.queryFilter(
          filter,
          fromBlock,
          currentBlock,
        );

        for (const event of events) {
          await this.processBscEvent(event, BigInt(currentBlock));
        }

        this.lastProcessedBlocks[Network.BEP20] = BigInt(currentBlock);
        await new Promise((resolve) =>
          setTimeout(resolve, config.retryInterval),
        );
      } catch (error) {
        console.error("Error watching BSC transactions:", error);
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
    }
  }

  private async processTronEvent(event: any, currentBlock: number) {
    const eventKey = `TRON:${event.transaction_id}:${event.event_index}`;
    if (this.processedEvents.has(eventKey)) return;

    try {
      const from = this.tronWeb.address.fromHex(event.result.from);
      const to = this.tronWeb.address.fromHex(event.result.to);
      const value = new BigNumber(event.result.value);

      await this.processTransferEvent(
        Network.TRC20,
        from,
        to,
        value,
        event,
        currentBlock,
      );

      this.processedEvents.set(eventKey, {
        transactionHash: event.transaction_id,
        eventIndex: event.event_index,
        blockNumber: event.block_number,
        processedAt: Date.now(),
        confirmations: currentBlock - event.block_number,
        network: Network.TRC20,
      });
    } catch (error) {
      console.error(`Error processing TRON event ${eventKey}:`, error);
    }
  }

  private async processBscEvent(
    event: ethers.EventLog | ethers.Log,
    currentBlock: bigint,
  ) {
    const eventKey = `BSC:${event.transactionHash}:${event.index}`;
    if (this.processedEvents.has(eventKey)) return;

    try {
      const args = (event as ethers.EventLog).args;
      if (!args) return;

      const from = args[0];
      const to = args[1];
      const value = new BigNumber(args[2].toString());

      await this.processTransferEvent(
        Network.BEP20,
        from,
        to,
        value,
        event,
        Number(currentBlock),
      );

      this.processedEvents.set(eventKey, {
        transactionHash: event.transactionHash,
        eventIndex: event.index,
        blockNumber: event.blockNumber,
        processedAt: Date.now(),
        confirmations: Number(currentBlock) - event.blockNumber,
        network: Network.BEP20,
      });
    } catch (error) {
      console.error(`Error processing BSC event ${eventKey}:`, error);
    }
  }

  private async processTransferEvent(
    network: Network,
    from: string,
    to: string,
    value: BigNumber,
    event: any,
    currentBlock: number,
  ) {
    const config = this.networkConfigs.get(network)!;

    for (const [id, tx] of this.watchedTransactions) {
      if (tx.attempts >= tx.maxAttempts) {
        await this.handleFailedTransaction(tx, "Max attempts reached");
        continue;
      }

      const fromMatches = from.toLowerCase() === tx.fromAddress.toLowerCase();
      const toMatches =
        to.toLowerCase() === tx.expectedRecipientAddress.toLowerCase();
      const valueMatches = value.toString() === tx.amount;

      if (tx.network === network && fromMatches && toMatches && valueMatches) {
        const confirmations =
          currentBlock -
          (network === Network.TRC20
            ? event.block_number
            : Number(event.blockNumber));

        if (confirmations < config.confirmations) {
          tx.lastChecked = Date.now();
          console.info(
            `Waiting for confirmations: ${confirmations}/${config.confirmations} for ${id} blockNum ${Number(event.blockNumber)}`,
          );

          this.pendingConfirmations.set(id, {
            network,
            transactionHash:
              network === Network.TRC20
                ? event.transaction_id
                : event.transactionHash,
            blockNumber:
              network === Network.TRC20
                ? event.block_number
                : Number(event.blockNumber),
          });
          continue;
        }

        try {
          const transactionHash =
            network === Network.TRC20
              ? event.transaction_id
              : event.transactionHash;
          const blockNumber =
            network === Network.TRC20
              ? event.block_number
              : Number(event.blockNumber);

          if (this.processingTransactions.has(id)) {
            console.info(
              `Transaction ${id} is already being processed, skipping`,
            );
            continue;
          }

          this.processingTransactions.add(id);
          await this.finalizeTransaction(
            tx.id,
            network,
            transactionHash,
            blockNumber,
            confirmations,
          );
          this.processingTransactions.delete(id);
        } catch (error) {
          this.processingTransactions.delete(id);
          tx.attempts++;
          console.error(`Failed to process transaction ${id}:`, error);
        }
        break;
      }
    }
  }

  private async checkPendingConfirmations() {
    if (this.pendingConfirmations.size === 0) return;

    const currentBlockNumbers = {
      [Network.BEP20]: await this.providers
        .get(Network.BEP20)!
        .getBlockNumber(),
      [Network.TRC20]: (await this.tronWeb.trx.getCurrentBlock()).block_header
        .raw_data.number,
    };

    for (const [id, tx] of this.pendingConfirmations) {
      // important to avoid processing and finalizing same transaction twice
      if (this.processingTransactions.has(id)) {
        console.info(
          `Transaction ${id} is already being processed, skipping confirmation check`,
        );
        continue;
      }

      const currentBlock = currentBlockNumbers[tx.network];
      const confirmations = currentBlock - tx.blockNumber;

      if (confirmations >= this.networkConfigs.get(tx.network)!.confirmations) {
        console.info(
          `Transaction ${id} now has enough confirmations (${confirmations})`,
        );
        this.processingTransactions.add(id);
        await this.finalizeTransaction(
          id,
          tx.network,
          tx.transactionHash,
          tx.blockNumber,
          confirmations,
        );
        this.pendingConfirmations.delete(id);
        this.processingTransactions.delete(id);
      }
    }
  }

  private async finalizeTransaction(
    id: string,
    network: Network,
    transactionHash: string,
    blockNumber: number,
    confirmations: number,
  ) {
    try {
      // Double-check block existence and hash before finalizing
      let isValid = false;
      let txStatus = false;

      if (network === Network.TRC20) {
        const block = await this.tronWeb.trx.getBlock(blockNumber);
        const txInfo = await this.tronWeb.trx.getTransaction(transactionHash);

        isValid = !!block && !!block.blockID;
        // For TRON: ret is null means pending, 0 means failed, 1 means success
        // @ts-ignore ret should be avaialble in txInfo
        txStatus = txInfo?.ret?.[0]?.contractRet === "SUCCESS";

        if (!txStatus) {
          console.warn(
            // @ts-ignore ret should be avaialble in txInfo
            `TRON transaction ${transactionHash} failed or pending: ${txInfo?.ret?.[0]?.contractRet}`,
          );
          await this.handleFailedTransaction(
            this.watchedTransactions.get(id)!,
            // @ts-ignore ret should be avaialble in txInfo
            `Transaction failed with status: ${txInfo?.ret?.[0]?.contractRet}`,
          );
          return;
        }
      } else if (network === Network.BEP20) {
        const provider = this.providers.get(Network.BEP20)!;
        const block = await provider.getBlock(blockNumber);
        const receipt = await provider.getTransactionReceipt(transactionHash);

        isValid = !!block && !!block.hash;
        txStatus = receipt?.status === 1;

        if (!txStatus) {
          console.warn(
            `BSC transaction ${transactionHash} failed with status: ${receipt?.status}`,
          );
          await this.handleFailedTransaction(
            this.watchedTransactions.get(id)!,
            `Transaction failed with status: ${receipt?.status}`,
          );
          return;
        }
      }

      if (!isValid) {
        console.warn(
          `Block ${blockNumber} not found during finalization, possible reorg`,
        );
        return;
      }

      // Verify the transfer event still exists in the transaction receipt
      let eventExists = false;
      try {
        if (network === Network.TRC20) {
          const events =
            await this.tronWeb.event.getEventsByTransactionID(transactionHash);
          eventExists =
            events?.data?.some(
              (event) =>
                event.event_name === "Transfer" &&
                event.contract_address ===
                  this.networkConfigs.get(Network.TRC20)!.contractAddress,
            ) || false;
        } else if (network === Network.BEP20) {
          const receipt = await this.providers
            .get(Network.BEP20)!
            .getTransactionReceipt(transactionHash);
          const contract = this.contracts.get(Network.BEP20)!;
          const transferEvents = await contract.queryFilter(
            contract.filters.Transfer(),
            receipt!.blockNumber,
            receipt!.blockNumber,
          );
          eventExists = transferEvents.some(
            (event) => event.transactionHash === transactionHash,
          );
        }

        if (!eventExists) {
          console.warn(
            `Transfer event not found in transaction ${transactionHash}`,
          );
          return;
        }
      } catch (error) {
        console.error(
          `Error verifying transfer event for ${transactionHash}:`,
          error,
        );
        return;
      }

      const update: TransactionUpdate = {
        id,
        network,
        status: TransactionStatus.COMPLETED,
        transactionHash,
        confirmations,
        blockNumber,
        isTestnet: this.isTestMode,
      };

      await sendWebhook(this.watchedTransactions.get(id)!.webhookUrl, update);
      this.watchedTransactions.delete(id);

      console.info(
        `${network} transaction finalized: ${id} (Confirmations: ${confirmations}, Status: Success)`,
      );
    } catch (error) {
      console.error(`Error finalizing transaction ${id}:`, error);
      // If we fail to verify the transaction, we should not finalize it
      const tx = this.watchedTransactions.get(id);
      if (tx) {
        tx.attempts++;
        if (tx.attempts >= tx.maxAttempts) {
          await this.handleFailedTransaction(
            tx,
            `Failed to verify transaction after ${tx.maxAttempts} attempts`,
          );
        }
      }
    }
  }

  private async handleFailedTransaction(
    tx: WatchedTransaction,
    reason: string,
  ) {
    try {
      const update: TransactionUpdate = {
        id: tx.id,
        network: tx.network,
        status: TransactionStatus.FAILED,
        isTestnet: this.isTestMode,
        error: reason,
      };

      await sendWebhook(tx.webhookUrl, update);
    } catch (error) {
      console.error(`Failed to send failure webhook for ${tx.id}:`, error);
    } finally {
      this.watchedTransactions.delete(tx.id);
    }
  }

  private async cleanupExpiredTransactions() {
    const currentTime = Date.now();
    for (const [id, tx] of this.watchedTransactions) {
      if (currentTime > tx.expiresAt) {
        try {
          const update: TransactionUpdate = {
            id: tx.id,
            network: tx.network,
            status: TransactionStatus.EXPIRED,
            isTestnet: this.isTestMode,
          };

          await sendWebhook(tx.webhookUrl, update);
          this.watchedTransactions.delete(id);
          console.info(`Transaction expired: ${id}`);
        } catch (error) {
          console.error(`Failed to process expiration for ${id}:`, error);
        }
      }
    }
  }

  private async cleanupOldProcessedEvents() {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, event] of this.processedEvents) {
      if (event.processedAt < oneDayAgo) {
        this.processedEvents.delete(key);
      }
    }
  }

  private async retryFailedTransactions() {
    for (const tx of this.watchedTransactions.values()) {
      if (
        tx.status === TransactionStatus.FAILED &&
        tx.attempts < tx.maxAttempts
      ) {
        tx.attempts++;
        tx.status = TransactionStatus.PENDING;
        console.info(
          `Retrying transaction ${tx.id}, attempt ${tx.attempts}/${tx.maxAttempts}`,
        );
      }
    }
  }

  async removeTransaction(id: string) {
    const tx = this.watchedTransactions.get(id);
    if (!tx) {
      throw new Error(`Transaction ${id} not found`);
    }
    this.watchedTransactions.delete(id);
    console.info(`Removed transaction from watch list: ${id}`);
  }

  async getNetworkStatus(network: Network) {
    const config = this.networkConfigs.get(network);
    if (!config) return null;

    return {
      network,
      enabled: config.enabled,
      isTestnet: config.isTestnet,
      confirmationsRequired: config.confirmations,
      minAmount: config.minAmount,
      maxAmount: config.maxAmount,
      lastProcessedBlock: this.lastProcessedBlocks[network],
      watchedTransactions: this.getWatchedTransactionsCount(network),
      blockTime: config.blockTime,
      retryInterval: config.retryInterval,
    };
  }

  getWatchedTransactionsCount(network?: Network): number {
    if (network) {
      return Array.from(this.watchedTransactions.values()).filter(
        (tx) => tx.network === network,
      ).length;
    }
    return this.watchedTransactions.size;
  }

  getProcessedEventsCount(): number {
    return this.processedEvents.size;
  }

  getLastProcessedBlock(network: Network): bigint {
    return this.lastProcessedBlocks[network];
  }

  stopWatchProcess() {
    this.isWatching = false;
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
    }
    console.info("Stopping watch process...");
  }

  // For testing and debugging purposes
  getWatchedTransaction(id: string): WatchedTransaction | undefined {
    return this.watchedTransactions.get(id);
  }

  // For administrative purposes
  setNetworkEnabled(network: Network, enabled: boolean) {
    const config = this.networkConfigs.get(network);
    if (!config) {
      throw new Error(`Network ${network} not found`);
    }
    config.enabled = enabled;
    console.info(`${network} ${enabled ? "enabled" : "disabled"}`);
  }

  updateNetworkConfig(network: Network, updates: Partial<NetworkConfig>) {
    const config = this.networkConfigs.get(network);
    if (!config) {
      throw new Error(`Network ${network} not found`);
    }
    Object.assign(config, updates);
    console.info(`${network} configuration updated`);
  }
}
