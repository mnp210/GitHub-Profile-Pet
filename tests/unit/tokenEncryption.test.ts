import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptToken,
  decryptToken,
  getEncryptionKey,
} from '../../src/lib/security/crypto.ts';

describe('Authenticated Token Encryption Engine (AES-256-GCM)', () => {
  const testKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const customKey = Buffer.from(testKeyHex, 'hex');

  it('successfully encrypts and decrypts OAuth access tokens', () => {
    const rawToken = 'ghu_AbCdEf1234567890_test_user_access_token';
    const encrypted = encryptToken(rawToken, customKey);

    assert.ok(encrypted.startsWith('v1:'), 'Ciphertext must start with version prefix');
    assert.notEqual(encrypted, rawToken, 'Ciphertext must not match raw token');

    const decrypted = decryptToken(encrypted, customKey);
    assert.equal(decrypted, rawToken, 'Decrypted token must exactly match original');
  });

  it('produces non-deterministic ciphertexts for identical inputs via random IVs', () => {
    const rawToken = 'ghr_refresh_token_secret_12345';
    const enc1 = encryptToken(rawToken, customKey);
    const enc2 = encryptToken(rawToken, customKey);

    assert.notEqual(enc1, enc2, 'Two encryptions of the same plaintext must use different IVs');
    assert.equal(decryptToken(enc1, customKey), rawToken);
    assert.equal(decryptToken(enc2, customKey), rawToken);
  });

  it('detects tampering and fails decryption when ciphertext is modified', () => {
    const rawToken = 'ghu_super_confidential_token';
    const encrypted = encryptToken(rawToken, customKey);
    const parts = encrypted.split(':');

    // Tamper with the ciphertext segment (part 3)
    const tamperedCipher = parts[3].slice(0, -2) + (parts[3].endsWith('0') ? '1' : '0');
    const tamperedPayload = `${parts[0]}:${parts[1]}:${parts[2]}:${tamperedCipher}`;

    assert.throws(() => {
      decryptToken(tamperedPayload, customKey);
    }, /tampered with|failed/i);
  });

  it('detects tampering and fails decryption when auth tag is modified', () => {
    const rawToken = 'ghu_super_confidential_token';
    const encrypted = encryptToken(rawToken, customKey);
    const parts = encrypted.split(':');

    // Tamper with the authentication tag segment (part 2) without changing length
    const tamperedTag = parts[2].slice(0, -1) + (parts[2].endsWith('0') ? '1' : '0');
    const tamperedPayload = `${parts[0]}:${parts[1]}:${tamperedTag}:${parts[3]}`;

    assert.throws(() => {
      decryptToken(tamperedPayload, customKey);
    }, /tampered with|failed/i);
  });

  it('rejects empty or null plaintexts', () => {
    assert.throws(() => {
      encryptToken('', customKey);
    }, /empty/i);
  });

  it('rejects malformed ciphertext structures', () => {
    assert.throws(() => {
      decryptToken('invalid-structure', customKey);
    }, /unsupported ciphertext format/i);

    assert.throws(() => {
      decryptToken('v1:only:two:three:parts', customKey);
    }, /structure/i);
  });

  it('validates 64-hex key parsing and throws on invalid key formats', () => {
    const validKey = getEncryptionKey(testKeyHex);
    assert.equal(validKey.length, 32);

    assert.throws(() => {
      getEncryptionKey('short_key');
    }, /Invalid TOKEN_ENCRYPTION_KEY/i);
  });
});
