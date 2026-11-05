/**
 * Audit hash-chain helpers shared by the API and the demo seed.
 *
 * Each tenant audit row stores `hash = sha256(prevHash + "\n" + canonicalJson)`.
 * Keeping the canonicalisation in one place guarantees that rows written by the
 * seed can still be verified by the API's `/audit/verify` endpoint.
 */
import { createHash } from 'node:crypto';
import { stableStringify } from '../attendance';

export { stableStringify };

export function hashEntry(prevHash: string, payload: Record<string, unknown>): string {
  return createHash('sha256').update(`${prevHash}\n${stableStringify(payload)}`).digest('hex');
}
