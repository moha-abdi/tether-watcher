# TRON Transaction Watcher

This is a service that watches for TRON (TRC20) USDT transactions and triggers a webhook when a specific transaction is completed or expired.

> [!CAUTION]
> This service is in its early stages of development and is expected to improve significantly over time. While it provides basic functionality for watching TRON (TRC20) USDT transactions, it should not be solely relied upon for production use at this stage. We recommend users to independently save transaction hashes to handle any cases in which transactions are resent by the webhook. Please stay tuned for future updates and improvements.

## Features

- Watch TRC20 USDT transactions on the TRON network.
- In-memory storage for watched transactions and processed events using JavaScript's `Map`.
- Automatically sends webhooks for completed and expired transactions.
- Uses `express` for routing, `helmet` for security, and `winston` for logging.

## Technologies

- **Node.js**
- **Express.js**
- **TronWeb** - To interact with the TRON blockchain.
- **BigNumber.js** - For handling large numbers in transactions.
- **Winston** - Logging framework.
- **Axios** - For sending webhooks.
- **Zod** - For validation.

## Setup

### Prerequisites

- Node.js v14+
- NPM or Yarn
- TRON API Key (for `TronWeb`)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/moha-abdi/TronWatch.git
   cd TronWatch
   ```

2. Install the dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file at the root of your project and add the following environment variables:

   ```
   PORT=3000
   TRON_FULL_HOST="https://api.trongrid.io"
   TRON_PRO_API_KEY="your-tron-api-key"
   USDT_CONTRACT_ADDRESS="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
   USDT_DEPOSIT_ADDRESS="YOUR USDT TRC-20 ADDRESS"
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

### API Endpoints

#### Add a Transaction to Watch

**POST** `/api/watcher/watch`

Request body:

```json
{
  "id": "unique-transaction-id",
  "fromAddress": "TRX-address",
  "amount": 100,
  "webhookUrl": "https://yourwebhook.com/transaction"
}
```

#### Remove a Transaction from Watch

**DELETE** `/api/watcher/watch/:id`

## How it Works

1. **In-Memory Transactions**: The service stores watched transactions and processed events in memory using JavaScript's `Map` instead of Redis.

2. **Watching Transactions**: The `TronWatcher` class listens for TRC20 `Transfer` events from the TRON network. If the transaction matches a watched one, a webhook is triggered.

3. **Expired Transactions**: Transactions are given a 5-minute window to be completed. If they expire, a webhook is sent notifying the user that the transaction has expired.

4. **Webhook Notification**: When a transaction is completed or expired, the service sends a POST request to the provided webhook URL with details of the transaction.

### Webhook Signature

To ensure secure communication, each webhook request includes an `X-Webhook-Signature` header. The signature is generated using HMAC-SHA256 and a secret key (`WEBHOOK_SECRET`). This allows the receiving server to verify that the webhook request came from a trusted source.

To generate the signature, the payload is hashed using the `WEBHOOK_SECRET`:

```typescript
import crypto from "crypto";

function generateSignature(payload: string): string {
  return crypto
    .createHmac("sha256", process.env.WEBHOOK_SECRET!)
    .update(payload)
    .digest("hex");
}
```

## Contributing

Feel free to fork this repository and contribute by submitting pull requests. For any major changes, please open an issue first to discuss the changes.

## License

[MIT](LICENSE)
