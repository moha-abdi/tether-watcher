import express from "express";
import { z } from "zod";
import { TronWatcher } from "../services/TronWatcher";
import { authenticateApiKey } from "../middleware/auth";

const watchSchema = z.object({
  id: z.string().nonempty(),
  fromAddress: z.string().nonempty(),
  amount: z.number().positive(),
  webhookUrl: z.string().url(),
});

export const watcherRoutes = (tronWatcher: TronWatcher) => {
  const router = express.Router();

  router.post("/watch", authenticateApiKey, async (req, res, next) => {
    const validation = watchSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ errors: validation.error.errors });
    }

    const { id, fromAddress, amount, webhookUrl } = req.body;
    try {
      await tronWatcher.addTransaction(id, fromAddress, amount, webhookUrl);
      res.json({ message: "Transaction added to watch list" });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/watch/:id", authenticateApiKey, async (req, res, next) => {
    try {
      await tronWatcher.removeTransaction(req.params.id);
      res.json({ message: "Transaction removed from watch list" });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
