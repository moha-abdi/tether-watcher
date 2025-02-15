import express from "express";
import { z } from "zod";
import {
  TetherWatcher,
  Network,
  TransactionStatus,
} from "../services/TetherWatcher";
import { authenticateApiKey } from "../middleware/auth";
import { logger } from "../utils/logger";

// Validation schemas
const watchSchema = z.object({
  id: z.string().nonempty(),
  network: z.nativeEnum(Network),
  fromAddress: z.string().nonempty(),
  expectedRecipientAddress: z.string().nonempty(),
  amount: z.number().positive(),
  webhookUrl: z.string().url(),
});

const networkConfigSchema = z.object({
  enabled: z.boolean().optional(),
  confirmations: z.number().min(1).optional(),
  minAmount: z.string().optional(),
  maxAmount: z.string().optional(),
  retryInterval: z.number().min(1000).optional(),
});

const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const watcherRoutes = (tetherWatcher: TetherWatcher) => {
  const router = express.Router();

  // Error handler middleware
  const errorHandler = (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    logger.error("Route error:", err);
    res.status(500).json({
      error: "Internal server error",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  };

  // Middleware to validate network parameter
  const validateNetwork = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const network = req.params.network as Network;
    try {
      await tetherWatcher.validateNetwork(network);
      next();
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  };

  // Transaction Management Routes
  router.post("/watch", authenticateApiKey, async (req, res, next) => {
    try {
      const validation = watchSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ errors: validation.error.errors });
        return;
      }

      const {
        id,
        network,
        fromAddress,
        expectedRecipientAddress,
        amount,
        webhookUrl,
      } = req.body;

      await tetherWatcher.addTransaction(
        id,
        network,
        fromAddress,
        expectedRecipientAddress,
        amount,
        webhookUrl,
      );

      res.json({
        message: `${network} transaction added to watch list`,
        isTestnet: tetherWatcher.isTestMode,
        transactionId: id,
      });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        next(error);
      }
    }
  });

  router.delete("/watch/:id", authenticateApiKey, async (req, res, next) => {
    try {
      await tetherWatcher.removeTransaction(req.params.id);
      res.json({
        message: "Transaction removed from watch list",
        transactionId: req.params.id,
      });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        next(error);
      }
    }
  });

  router.get("/watch/:id", authenticateApiKey, async (req, res, next) => {
    try {
      const transaction = tetherWatcher.getWatchedTransaction(req.params.id);
      if (!transaction) {
        res.status(404).json({ error: "Transaction not found" });
        return;
      }
      res.json({
        transaction,
        isTestnet: tetherWatcher.isTestMode,
      });
    } catch (error) {
      next(error);
    }
  });

  // Network Status and Configuration Routes
  router.get("/networks", authenticateApiKey, async (req, res) => {
    const networks = await Promise.all(
      Object.values(Network).map(async (network) => {
        return await tetherWatcher.getNetworkStatus(network);
      }),
    );

    res.json({
      networks: networks.filter((n) => n !== null),
      isTestnet: tetherWatcher.isTestMode,
    });
  });

  router.get(
    "/networks/:network",
    authenticateApiKey,
    validateNetwork,
    async (req, res, next) => {
      try {
        const network = req.params.network as Network;
        const status = await tetherWatcher.getNetworkStatus(network);
        if (!status) {
          res.status(404).json({ error: "Network not found" });
          return;
        }
        res.json(status);
      } catch (error) {
        next(error);
      }
    },
  );

  // Administrative Routes (protected by admin authentication)
  // TODO: use seperate authentication for admin routes instead of default authenticateApiKey
  router.patch(
    "/admin/networks/:network",
    authenticateApiKey,
    validateNetwork,
    async (req, res, next) => {
      try {
        const network = req.params.network as Network;
        const validation = networkConfigSchema.safeParse(req.body);

        if (!validation.success) {
          res.status(400).json({ errors: validation.error.errors });
          return;
        }

        await tetherWatcher.updateNetworkConfig(network, validation.data);
        res.json({
          message: `${network} configuration updated`,
          network: await tetherWatcher.getNetworkStatus(network),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/admin/networks/:network/enable",
    authenticateApiKey,
    validateNetwork,
    async (req, res, next) => {
      try {
        const network = req.params.network as Network;
        await tetherWatcher.setNetworkEnabled(network, true);
        res.json({
          message: `${network} enabled`,
          status: await tetherWatcher.getNetworkStatus(network),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/admin/networks/:network/disable",
    authenticateApiKey,
    validateNetwork,
    async (req, res, next) => {
      try {
        const network = req.params.network as Network;
        await tetherWatcher.setNetworkEnabled(network, false);
        res.json({
          message: `${network} disabled`,
          status: await tetherWatcher.getNetworkStatus(network),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // Monitoring Routes
  router.get("/stats", authenticateApiKey, async (req, res) => {
    const validation = dateRangeSchema.safeParse(req.query);
    if (!validation.success) {
      res.status(400).json({ errors: validation.error.errors });
    }

    const stats = {
      watchedTransactions: {
        total: tetherWatcher.getWatchedTransactionsCount(),
        byNetwork: Object.values(Network).reduce(
          (acc, network) => ({
            ...acc,
            [network]: tetherWatcher.getWatchedTransactionsCount(network),
          }),
          {},
        ),
      },
      processedEvents: tetherWatcher.getProcessedEventsCount(),
      lastProcessedBlocks: Object.values(Network).reduce(
        (acc, network) => ({
          ...acc,
          [network]: tetherWatcher.getLastProcessedBlock(network),
        }),
        {},
      ),
      isTestnet: tetherWatcher.isTestMode,
    };

    res.json(stats);
  });

  // Health Check Route (no authentication required)
  router.get("/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      isTestnet: tetherWatcher.isTestMode,
    });
  });

  // Apply error handler to all routes
  router.use(errorHandler);

  return router;
};

// Export types for external use
export type WatcherRoutes = ReturnType<typeof watcherRoutes>;
