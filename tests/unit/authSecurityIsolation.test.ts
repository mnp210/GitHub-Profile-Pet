import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolveServerUser } from '../../src/lib/auth/sessionContext.ts';

describe('Production Test Identity Isolation & Fail-Closed Security', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  after(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  it('CRITICAL: Production environment STRICTLY rejects x-test-trainer-handle header', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const req = new Request('http://localhost:3000/api/pet/action', {
      method: 'POST',
      headers: {
        'x-test-trainer-handle': 'admin_shadow_claw',
      },
    });

    const user = await resolveServerUser(req);
    assert.equal(user, null, 'Production MUST reject x-test-trainer-handle and fail closed');
  });

  it('CRITICAL: Production environment STRICTLY rejects x-test-user-id header', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const req = new Request('http://localhost:3000/api/pet/action', {
      method: 'POST',
      headers: {
        'x-test-user-id': '00000000-0000-0000-0000-000000000001',
      },
    });

    const user = await resolveServerUser(req);
    assert.equal(user, null, 'Production MUST reject x-test-user-id and fail closed');
  });

  it('Production fails closed when no valid session cookie exists', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const req = new Request('http://localhost:3000/api/pet/action', {
      method: 'POST',
      headers: {
        'cookie': 'theme=dark; other_cookie=xyz',
      },
    });

    const user = await resolveServerUser(req);
    assert.equal(user, null, 'Production must return null when no session token exists');
  });

  it('Production fails closed when provided with a random non-existent session token', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const req = new Request('http://localhost:3000/api/pet/action', {
      method: 'POST',
      headers: {
        'cookie': 'pet_session=completely_fake_and_nonexistent_session_token_123',
      },
    });

    const user = await resolveServerUser(req);
    assert.equal(user, null, 'Invalid session token must fail closed in production');
  });
});
