import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getAccountGreeting } from '../../src/types/auth.ts';
import type { UserAccountState } from '../../src/types/auth.ts';

describe('Account-Aware Dynamic Greeting Engine', () => {
  test('returns disconnected greeting for unauthenticated guests', () => {
    const account: UserAccountState = {
      status: 'disconnected',
    };

    const greeting = getAccountGreeting(account);

    assert.strictEqual(greeting.heading, 'WELCOME, TRAINER!');
    assert.strictEqual(greeting.badgeText, 'DISCONNECTED');
    assert.strictEqual(greeting.isDemo, false);
    assert.strictEqual(greeting.isConnected, false);
    assert.strictEqual(greeting.usernameDisplay, 'Guest Trainer');
  });

  test('returns simulated demo greeting for demo trainer account', () => {
    const account: UserAccountState = {
      status: 'demo',
      profile: {
        username: 'octocat-trainer',
        displayName: 'The Octocat Trainer',
      },
    };

    const greeting = getAccountGreeting(account);

    assert.strictEqual(greeting.heading, 'WELCOME BACK, OCTOCAT-TRAINER!');
    assert.strictEqual(greeting.badgeText, 'DEMO MODE');
    assert.strictEqual(greeting.isDemo, true);
    assert.strictEqual(greeting.isConnected, true);
    assert.strictEqual(greeting.usernameDisplay, 'octocat-trainer');
  });

  test('returns authenticated greeting with @handle for authenticated GitHub users', () => {
    const account: UserAccountState = {
      status: 'authenticated',
      profile: {
        username: 'mona-lisa-dev',
        displayName: 'Mona Lisa',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        profileUrl: 'https://github.com/mona-lisa-dev',
      },
    };

    const greeting = getAccountGreeting(account);

    assert.strictEqual(greeting.heading, 'WELCOME BACK, @MONA-LISA-DEV!');
    assert.strictEqual(greeting.badgeText, 'CONNECTED');
    assert.strictEqual(greeting.isDemo, false);
    assert.strictEqual(greeting.isConnected, true);
    assert.strictEqual(greeting.usernameDisplay, '@mona-lisa-dev');
  });

  test('normalizes username if handle already includes leading @ symbol', () => {
    const account: UserAccountState = {
      status: 'authenticated',
      profile: {
        username: '@torvalds',
      },
    };

    const greeting = getAccountGreeting(account);

    assert.strictEqual(greeting.heading, 'WELCOME BACK, @TORVALDS!');
    assert.strictEqual(greeting.usernameDisplay, '@torvalds');
  });
});
