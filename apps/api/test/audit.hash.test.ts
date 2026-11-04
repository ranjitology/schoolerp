import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashEntry, stableStringify } from '../src/audit/audit.service';

describe('audit hash chain helpers', () => {
  it('serialises objects deterministically regardless of key order', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
    expect(stableStringify({ nested: [{ z: true, a: null }] })).toBe(
      '{"nested":[{"a":null,"z":true}]}',
    );
  });

  it('produces a stable SHA-256 hash for identical entries', () => {
    const payload = { action: 'student.created', entity: 'Student', entityId: 'abc' };
    const first = hashEntry('0'.repeat(64), payload);
    const second = hashEntry('0'.repeat(64), { entityId: 'abc', entity: 'Student', action: 'student.created' });

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
    expect(first).toBe(
      createHash('sha256')
        .update(`0${'0'.repeat(63)}\n${stableStringify(payload)}`)
        .digest('hex'),
    );
  });

  it('changes when the previous hash or payload changes', () => {
    const payload = { action: 'student.created' };

    expect(hashEntry('0'.repeat(64), payload)).not.toBe(hashEntry('1'.repeat(64), payload));
    expect(hashEntry('0'.repeat(64), payload)).not.toBe(
      hashEntry('0'.repeat(64), { action: 'student.updated' }),
    );
  });
});
