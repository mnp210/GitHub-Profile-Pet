// src/lib/security/crypto.ts
// Production-grade cryptographic operations: AES-256-GCM token encryption, SHA-256 session hashing, and timing-safe comparisons

import crypto from 'node:crypto';

const GCM_IV_LENGTH = 12; // 96-bit IV recommended for AES-GCM
const GCM_AUTH_TAG_LENGTH = 16; // 128-bit authentication tag
const GCM_ALGORITHM = 'aes-256-gcm';
const TOKEN_AAD = Buffer.from('github_token', 'utf8');

// Deterministic fallback key strictly for isolated local development and automated testing
const DEV_FALLBACK_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/**
 * Retrieves the 256-bit (32-byte) key for AES-GCM encryption.
 * In production, strictly requires a valid 64-hex character TOKEN_ENCRYPTION_KEY env var.
 */
export function getEncryptionKey(overrideKey?: string): Buffer {
  const rawKey = overrideKey || process.env.TOKEN_ENCRYPTION_KEY;

  if (rawKey) {
    const trimmed = rawKey.trim();
    if (trimmed.length === 64 && /^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }
    if (Buffer.byteLength(trimmed, 'utf8') === 32) {
      return Buffer.from(trimmed, 'utf8');
    }
    throw new Error(
      'Invalid TOKEN_ENCRYPTION_KEY: Expected 64 hex characters (32 bytes) or 32 raw bytes.'
    );
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL SECURITY ERROR: TOKEN_ENCRYPTION_KEY environment variable is mandatory in production.'
    );
  }

  return Buffer.from(DEV_FALLBACK_KEY_HEX, 'hex');
}

/**
 * Encrypts a sensitive string (such as an OAuth access or refresh token) using authenticated AES-256-GCM.
 * Output format: `v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`
 */
export function encryptToken(plainText: string, customKey?: Buffer): string {
  if (!plainText) {
    throw new Error('Cannot encrypt empty or null payload.');
  }

  const key = customKey || getEncryptionKey();
  const iv = crypto.randomBytes(GCM_IV_LENGTH);

  const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv, {
    authTagLength: GCM_AUTH_TAG_LENGTH,
  });
  cipher.setAAD(TOKEN_AAD);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts an authenticated AES-256-GCM ciphertext payload.
 * Throws an error if the payload has been tampered with or if the authentication tag fails.
 */
export function decryptToken(cipherText: string, customKey?: Buffer): string {
  if (!cipherText || !cipherText.startsWith('v1:')) {
    throw new Error('Invalid or unsupported ciphertext format.');
  }

  const parts = cipherText.split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed ciphertext segment structure.');
  }

  const [, ivHex, tagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  if (iv.length !== GCM_IV_LENGTH || authTag.length !== GCM_AUTH_TAG_LENGTH) {
    throw new Error('Invalid IV or authentication tag length.');
  }

  const key = customKey || getEncryptionKey();

  const decipher = crypto.createDecipheriv(GCM_ALGORITHM, key, iv, {
    authTagLength: GCM_AUTH_TAG_LENGTH,
  });
  decipher.setAAD(TOKEN_AAD);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error(`Token decryption failed or payload was tampered with: ${(err as Error).message}`);
  }
}

/**
 * Generates a cryptographically random, unpredictable hex token.
 * Default 32 bytes (256 bits) provides 64 hex characters.
 */
export function generateRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Computes a SHA-256 hash of a session token for secure database storage.
 * The raw token is stored in the user's browser cookie; only the hash is persisted.
 */
export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/**
 * Constant-time string comparison to defend against timing attacks.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}
