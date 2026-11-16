import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRandomToken,
  constantTimeCompare,
} from '../../src/lib/security/crypto.ts';
import {
  buildGitHubAuthorizationUrl,
} from '../../src/lib/auth/githubAuth.ts';

describe('OAuth State Security & Authorization URL Construction', () => {
  it('generates random unpredictable state tokens', () => {
    const s1 = generateRandomToken(32);
    const s2 = generateRandomToken(32);

    assert.equal(s1.length, 64);
    assert.equal(s2.length, 64);
    assert.notEqual(s1, s2);
  });

  it('performs timing-safe comparison on valid matching states', () => {
    const state = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    assert.equal(constantTimeCompare(state, state), true);
  });

  it('rejects mismatched states via timing-safe comparison', () => {
    const s1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const s2 = 'b1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    assert.equal(constantTimeCompare(s1, s2), false);
  });

  it('rejects different length states safely', () => {
    assert.equal(constantTimeCompare('state123', 'state12'), false);
    assert.equal(constantTimeCompare('', 'state12'), false);
  });

  it('builds zero-scope GitHub App authorization URL by default', () => {
    const authUrl = buildGitHubAuthorizationUrl({
      clientId: 'gh_app_client_123',
      redirectUri: 'http://localhost:3000/api/auth/callback',
      state: 'rand_state_val',
    });

    const parsed = new URL(authUrl);
    assert.equal(parsed.origin, 'https://github.com');
    assert.equal(parsed.pathname, '/login/oauth/authorize');
    assert.equal(parsed.searchParams.get('client_id'), 'gh_app_client_123');
    assert.equal(parsed.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/callback');
    assert.equal(parsed.searchParams.get('state'), 'rand_state_val');
    assert.equal(parsed.searchParams.has('scope'), false, 'Default auth must not request unnecessary scopes');
  });

  it('includes optional scope when explicitly specified', () => {
    const authUrl = buildGitHubAuthorizationUrl({
      clientId: 'gh_app_client_123',
      redirectUri: 'http://localhost:3000/api/auth/callback',
      state: 'rand_state_val',
      scope: 'read:user',
    });

    const parsed = new URL(authUrl);
    assert.equal(parsed.searchParams.get('scope'), 'read:user');
  });
});
