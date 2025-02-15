# TRON & BSC Transaction Watcher

This is a service that watches for USDT transactions on both TRON (TRC20) and BSC (BEP20) networks and triggers webhooks when specific transactions are completed, failed, or expired.

> [!CAUTION]
> This service is in its early stages of development and is expected to improve significantly over time. While it provides functionality for watching USDT transactions on TRON and BSC networks, it should not be solely relied upon for production use at this stage. We recommend users to independently save transaction hashes to handle any cases in which transactions are resent by the webhook. Please stay tuned for future updates and improvements.

## Features

- Watch USDT transactions on both TRON (TRC20) and BSC (BEP20) networks
- In-memory storage for watched transactions and processed events using JavaScript's `Map`
- Configurable confirmation requirements per network
- Automatic retries for failed transactions
- Comprehensive webhook notifications for transaction status changes
- Supports both mainnet and testnet environments
- Network-specific configuration (min/max amounts, block times, retry intervals)
- Administrative API endpoints for network management
- Monitoring endpoints for service health and statistics

## Technologies

- **Node.js**
- **Express.js**
- **TronWeb** - To interact with the TRON blockchain
- **Ethers.js** - To interact with the BSC blockchain
- **BigNumber.js** - For handling large numbers in transactions
- **Winston** - Logging framework
- **Axios** - For sending webhooks
- **Zod** - For request validation

## Setup

### Prerequisites

- Node.js v14+
- NPM or Yarn
- TRON API Key (for `TronWeb`)
- TRON RPC URL (for mainnet/testnet)
- BSC RPC URL (for mainnet/testnet)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/moha-abdi/tether-watcher.git
   cd tether-watcher
   ```

2. Install the dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file at the root of your project and add the following environment variables:

   ```
   PORT=3000
   NODE_ENV=development  # or production

   # TRON Configuration
   TRON_MAINNET_URL="https://api.trongrid.io"
   TRON_TESTNET_URL="https://api.shasta.trongrid.io"
   TRON_PRO_API_KEY="your-tron-api-key"
   TRON_MAINNET_CONTRACT="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
   TRON_TESTNET_CONTRACT="your-testnet-contract"

   # BSC Configuration
   BSC_MAINNET_URL="https://bsc-dataseed.binance.org"
   BSC_TESTNET_URL="https://data-seed-prebsc-1-s1.binance.org:8545"
   BSC_MAINNET_CONTRACT="0x55d398326f99059fF775485246999027B3197955"
   BSC_TESTNET_CONTRACT="your-testnet-contract"

   # Security
   API_KEY="your-secure-api-key"
   WEBHOOK_SECRET="your-secure-webhook-secret"
   ```

4. Build the project:

   ```bash
   npm run build
   ```

5. Run the application:
   ```bash
   npm start
   ```

### Development

For development, use the following command to start the server with `ts-node-dev`:

```bash
npm run dev
```

## API Endpoints

### Transaction Management

#### Add a Transaction to Watch

**POST** `/api/watcher/watch`

Request body:
```json
{
  "id": "unique-transaction-id",
  "network": "TRON",  // or "BSC"
  "fromAddress": "sender-address",
  "expectedRecipientAddress": "recipient-address",
  "amount": 100,
  "webhookUrl": "https://yourwebhook.com/transaction"
}
```

#### Remove a Transaction from Watch

**DELETE** `/api/watcher/watch/:id`

#### Get Transaction Status

**GET** `/api/watcher/watch/:id`

### Network Management

#### Get All Networks Status

**GET** `/api/watcher/networks`

#### Get Specific Network Status

**GET** `/api/watcher/networks/:network`

## Webhook Notifications

The service sends webhook notifications for the following transaction states:
- COMPLETED: Transaction confirmed with required confirmations
- FAILED: Transaction failed or exceeded maximum retry attempts
- EXPIRED: Transaction not found within the expiration window

Each webhook request includes:
- Transaction ID
- Network (TRON/BSC)
- Status
- Transaction hash (for completed transactions)
- Block number (for completed transactions)
- Number of confirmations (for completed transactions)
- Error message (for failed transactions)
- Network mode (testnet/mainnet)

### Webhook Security

Each webhook request includes an `X-Webhook-Signature` header for verification. The signature is generated using HMAC-SHA256 and your webhook secret:

```typescript
import crypto from "crypto";

function verifyWebhookSignature(payload: string, signature: string): boolean {
  const expectedSignature = crypto
    .createHmac("sha256", process.env.WEBHOOK_SECRET!)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

## Contributing

Feel free to fork this repository and contribute by submitting pull requests. For any major changes, please open an issue first to discuss the changes.

## License

[MIT](LICENSE)