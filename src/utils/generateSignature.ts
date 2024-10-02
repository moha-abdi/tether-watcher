import crypto from "crypto";

export function generateSignature(payload: string): string {
  return crypto
    .createHmac("sha256", process.env.WEBHOOK_SECRET!)
    .update(payload)
    .digest("hex");
}
