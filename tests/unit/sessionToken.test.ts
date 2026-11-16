import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRandomToken,
  hashSessionToken,
} from '../../src/lib/security/crypto.ts';
import {
  formatSessionCookie,
  formatClearSessionCookie,
  parseCookies,
  SESSION_COOKIE_NAME,
} from '../../src/lib/auth/sessionContext.ts';

describe('Persistent Session Token & Cookie Engine', () => {
  it('generates 64-hex character unpredictable random tokens', () => {
    const token1 = generateRandomToken(32);
    const token2 = generateRandomToken(32);

    assert.equal(token1.length, 64);
    assert.equal(token2.length, 64);
    assert.notEqual(token1, token2);
    assert.match(token1, /^[0-9a-f]{64}$/);
  });

  it('computes deterministic SHA-256 hashes for raw session tokens', () => {
    const rawToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const hash1 = hashSessionToken(rawToken);
    const hash2 = hashSessionToken(rawToken);

    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
    assert.notEqual(hash1, rawToken);
  });

  it('formats production session cookies with HttpOnly, Path=/, SameSite=Lax, and Max-Age', () => {
    const rawToken = 'test_session_raw_token_value_123';
    const cookie = formatSessionCookie(rawToken, 3600);

    assert.ok(cookie.includes(`${SESSION_COOKIE_NAME}=${rawToken}`));
    assert.ok(cookie.includes('HttpOnly'));
    assert.ok(cookie.includes('Path=/'));
    assert.ok(cookie.includes('SameSite=Lax'));
    assert.ok(cookie.includes('Max-Age=3600'));
  });

  it('formats clear session cookie with Max-Age=0 and expired timestamp', () => {
    const clearCookie = formatClearSessionCookie();

    assert.ok(clearCookie.includes(`${SESSION_COOKIE_NAME}=`));
    assert.ok(clearCookie.includes('Max-Age=0'));
    assert.ok(clearCookie.includes('Expires=Thu, 01 Jan 1970'));
  });

  it('correctly parses multiple cookies from standard HTTP Cookie headers', () => {
    const cookieHeader = 'pet_session=tok_123; other_cookie=val_456; theme=dark';
    const parsed = parseCookies(cookieHeader);

    assert.equal(parsed['pet_session'], 'tok_123');
    assert.equal(parsed['other_cookie'], 'val_456');
    assert.equal(parsed['theme'], 'dark');
  });

  it('gracefully handles missing or malformed cookie headers', () => {
    assert.deepEqual(parseCookies(null), {});
    assert.deepEqual(parseCookies(''), {});
    assert.deepEqual(parseCookies('   '), {});
  });
});
