// tests/unit/actionValidation.test.ts
// Unit tests for Care Action request validation

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateCareActionPayload } from '../../src/lib/gameplay/validation.ts';

describe('Care Action Request Payload Validation', () => {
  test('rejects non-object and null payloads', () => {
    assert.equal(validateCareActionPayload(null).valid, false);
    assert.equal(validateCareActionPayload(undefined).valid, false);
    assert.equal(validateCareActionPayload('string').valid, false);
    assert.equal(validateCareActionPayload(123).valid, false);
  });

  test('rejects invalid or unknown action types', () => {
    const res = validateCareActionPayload({ action: 'fly', clientActionId: 'uuid-1' });
    assert.equal(res.valid, false);
    if (!res.valid) {
      assert.match(res.error, /Invalid action "fly"/);
    }
  });

  test('rejects missing or empty clientActionId', () => {
    const missing = validateCareActionPayload({ action: 'train' });
    assert.equal(missing.valid, false);

    const empty = validateCareActionPayload({ action: 'train', clientActionId: '   ' });
    assert.equal(empty.valid, false);
  });

  test('rejects clientActionId exceeding 64 characters', () => {
    const longId = 'a'.repeat(65);
    const res = validateCareActionPayload({ action: 'feed', clientActionId: longId });
    assert.equal(res.valid, false);
    if (!res.valid) {
      assert.match(res.error, /exceeds maximum length/);
    }
  });

  test('accepts valid train, feed, rest, and pet actions', () => {
    const actions = ['train', 'feed', 'rest', 'pet'] as const;
    for (const action of actions) {
      const res = validateCareActionPayload({ action, clientActionId: `valid-${action}-id` });
      assert.equal(res.valid, true);
      if (res.valid) {
        assert.equal(res.data.action, action);
        assert.equal(res.data.clientActionId, `valid-${action}-id`);
      }
    }
  });

  test('trims whitespace from clientActionId', () => {
    const res = validateCareActionPayload({ action: 'rest', clientActionId: '  trimmed-id  ' });
    assert.equal(res.valid, true);
    if (res.valid) {
      assert.equal(res.data.clientActionId, 'trimmed-id');
    }
  });
});
