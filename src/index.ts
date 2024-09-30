import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { TronWatcher } from "./services/TronWatcher";
import { watcherRoutes } from "./routes/watcherRoutes";
import { errorHandler } from "./middleware/errorHandler";
import { setupLogging } from "./utils/logger";

dotenv.config();

const app = express();

// Security headers
app.use(helmet());

// JSON body parsing
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Setup logging
setupLogging(app);

// Initialize TronWatcher
const tronWatcher = new TronWatcher();
tronWatcher.startWatchProcess();

// Routes
app.use("/api/watcher", watcherRoutes(tronWatcher));

// Error handling
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TRON Transaction Watcher Service running on port ${PORT}`);
});
