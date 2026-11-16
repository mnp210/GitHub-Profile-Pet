import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyRequestOrigin,
  sanitizeReturnUrl,
} from '../../src/lib/security/csrf.ts';

describe('CSRF Origin & Open-Redirect Protection', () => {
  it('allows safe read-only HTTP methods (GET, HEAD, OPTIONS) without origin check', () => {
    const getReq = new Request('http://localhost:3000/api/auth/me', { method: 'GET' });
    assert.equal(verifyRequestOrigin(getReq).valid, true);

    const headReq = new Request('http://localhost:3000/api/auth/me', { method: 'HEAD' });
    assert.equal(verifyRequestOrigin(headReq).valid, true);
  });

  it('allows state-changing requests when Origin header matches Host', () => {
    const postReq = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        'host': 'localhost:3000',
        'origin': 'http://localhost:3000',
      },
    });

    const result = verifyRequestOrigin(postReq);
    assert.equal(result.valid, true);
  });

  it('rejects state-changing requests from untrusted foreign origins', () => {
    const postReq = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        'host': 'localhost:3000',
        'origin': 'https://evil-hacker-site.com',
      },
    });

    const result = verifyRequestOrigin(postReq);
    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes('Cross-origin request rejected'));
  });

  it('verifies Referer origin when Origin header is omitted', () => {
    const postReq = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        'host': 'localhost:3000',
        'referer': 'http://localhost:3000/settings',
      },
    });

    const result = verifyRequestOrigin(postReq);
    assert.equal(result.valid, true);
  });

  it('sanitizes valid relative return URLs safely', () => {
    assert.equal(sanitizeReturnUrl('/'), '/');
    assert.equal(sanitizeReturnUrl('/dashboard'), '/dashboard');
    assert.equal(sanitizeReturnUrl('/settings?tab=profile'), '/settings?tab=profile');
    assert.equal(sanitizeReturnUrl(''), '/');
    assert.equal(sanitizeReturnUrl(null), '/');
  });

  it('strictly blocks open-redirect attack vectors', () => {
    // Protocol-relative exploit
    assert.equal(sanitizeReturnUrl('//evil.com'), '/');
    // Absolute HTTP URL exploit
    assert.equal(sanitizeReturnUrl('https://evil.com/phishing'), '/');
    assert.equal(sanitizeReturnUrl('http://evil.com'), '/');
    // Backslash escape exploits
    assert.equal(sanitizeReturnUrl('/\\evil.com'), '/');
    assert.equal(sanitizeReturnUrl('\\evil.com'), '/');
    // Scheme exploits
    assert.equal(sanitizeReturnUrl('javascript:alert(1)'), '/');
    assert.equal(sanitizeReturnUrl('data:text/html,malicious'), '/');
  });
});
