/**
 * RFC 9562 UUIDv7 generation with an in-process monotonic counter.
 *
 * Layout: 48-bit unix_ts_ms | 4-bit version (7) | 12-bit monotonic counter |
 * 2-bit variant (10) | 62-bit random. The counter makes IDs generated in the
 * same millisecond strictly increasing within a process, which keeps B-tree
 * inserts sequential without a central atomic sequence (the prototype's
 * `length + 1` bug).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CounterState {
  lastTimestamp: number;
  counter: number;
}

/**
 * Real-clock and fixture-clock state are tracked independently. Tests can pin
 * `now` without being clamped by a previously generated real-time ID, while
 * production calls (no override) still defend against clock skew.
 */
const systemState: CounterState = { lastTimestamp: -1, counter: 0 };
const fixtureState: CounterState = { lastTimestamp: -1, counter: 0 };

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.getRandomValues) {
    throw new Error('Web Crypto API is required for secure ID generation');
  }
  webCrypto.getRandomValues(bytes);
  return bytes;
}

export interface UuidV7Options {
  /** Override clock (tests / deterministic fixtures). */
  now?: number;
  /** Override random source (tests). Must return exactly `length` bytes. */
  random?: (length: number) => Uint8Array;
}

function nextCounter(state: CounterState, requested: number, random: (n: number) => Uint8Array): number {
  let timestamp = requested;

  if (timestamp === state.lastTimestamp) {
    state.counter = (state.counter + 1) & 0x0fff;
    if (state.counter === 0) {
      // Counter exhausted: move to the next millisecond rather than reuse IDs.
      state.lastTimestamp += 1;
      state.counter = ((random(2)[0] ?? 0) % 0x0fff) + 1;
    }
  } else if (timestamp > state.lastTimestamp) {
    state.lastTimestamp = timestamp;
    state.counter =
      (((random(2)[0] ?? 0) << 8) | Math.floor((random(2)[0] ?? 0) / 16)) & 0x0fff;
  } else {
    // Clock moved backwards; keep ordering monotonic.
    timestamp = state.lastTimestamp;
    state.counter = (state.counter + 1) & 0x0fff;
    if (state.counter === 0) {
      state.lastTimestamp += 1;
      timestamp = state.lastTimestamp;
      state.counter = 1;
    }
  }

  return timestamp;
}

export function uuidv7(options: UuidV7Options = {}): string {
  const random = options.random ?? randomBytes;
  const state = options.now === undefined ? systemState : fixtureState;
  const requested = options.now ?? Date.now();

  if (requested > 0xffffffffffff) {
    throw new RangeError('Timestamp exceeds 48 bits');
  }

  const timestamp = nextCounter(state, requested, random);

  const bytes = random(16);
  const tsHigh = Math.floor(timestamp / 2 ** 32);
  const tsLow = timestamp >>> 0;

  const out = new Uint8Array(16);
  out[0] = (tsHigh >>> 8) & 0xff;
  out[1] = tsHigh & 0xff;
  out[2] = (tsLow >>> 24) & 0xff;
  out[3] = (tsLow >>> 16) & 0xff;
  out[4] = (tsLow >>> 8) & 0xff;
  out[5] = tsLow & 0xff;
  out[6] = 0x70 | ((state.counter >>> 8) & 0x0f);
  out[7] = state.counter & 0xff;
  out[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  for (let i = 9; i < 16; i += 1) {
    out[i] = bytes[i] ?? 0;
  }

  return formatUuid(out);
}

function formatUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (const byte of bytes) hex.push(byte.toString(16).padStart(2, '0'));
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(
    16,
    20,
  )}-${joined.slice(20)}`;
}

export function isUuidV7(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Extracts the embedded millisecond timestamp. Throws for non-v7 input. */
export function uuidv7Timestamp(value: string): number {
  if (!isUuidV7(value)) throw new Error('Not a UUIDv7');
  return Number.parseInt(value.replace(/-/g, '').slice(0, 12), 16);
}

/** RFC 4122/9562 nil UUID, useful as a sentinel that is never a valid entity id. */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
