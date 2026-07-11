/**
 * sha256 — Node-only content hashing for the write path (pack/flush).
 *
 * Kept out of the isomorphic read core: reading never hashes, so the browser
 * bundle never pulls in `crypto`. A `Hasher` can be injected into the container
 * so a non-Node backing may supply its own (or omit sha256 entirely).
 */

import { createHash } from 'crypto';

/** Hash bytes to a lowercase hex sha256 string. */
export type Hasher = (data: Uint8Array) => string;

/** The default Node hasher. */
export const sha256Hex: Hasher = (data) =>
  createHash('sha256').update(data).digest('hex');
