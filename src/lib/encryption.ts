/**
 * Simple AES-256-GCM encryption for sensitive fields (bank account numbers).
 * Key is derived from ENCRYPTION_KEY env var.
 *
 * Encrypted values are stored as: iv:authTag:ciphertext (all hex-encoded).
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY is not configured");
  // Hash the key to ensure it's exactly 32 bytes
  return crypto.createHash("sha256").update(key).digest();
}

/**
 * Encrypt a plaintext string.
 * Returns "iv:authTag:ciphertext" in hex.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an encrypted string (iv:authTag:ciphertext in hex).
 * Returns the original plaintext.
 */
export function decrypt(encryptedString: string): string {
  const key = getKey();
  const [ivHex, authTagHex, ciphertext] = encryptedString.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
