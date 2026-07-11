/**
 * sniff — distinguish a legacy XML `.cryo` from a tar `.cryo` container.
 *
 * Backwards-compat cornerstone (MIGRATION-cryo-container.md §4.3): one file
 * extension, one icon. We peek the leading bytes rather than trust the name.
 *
 * This module is pure/isomorphic (Uint8Array, no fs). The fs-backed `sniffFile`
 * lives in sniff-file.ts so the browser bundle never pulls in `fs`.
 */

export type CryoKind = 'xml' | 'container' | 'unknown';

const SNIFF_DECODER = new TextDecoder('utf-8');

/** Classify already-read leading bytes of a `.cryo` file. Isomorphic (Uint8Array). */
export function sniffBytes(head: Uint8Array): CryoKind {
  // A USTAR header carries the magic "ustar" at offset 257.
  if (
    head.length >= 262 &&
    SNIFF_DECODER.decode(head.subarray(257, 262)) === 'ustar'
  ) {
    return 'container';
  }
  // Skip a UTF-8 BOM if present, then look for an XML/cryo opening.
  let start = 0;
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    start = 3;
  }
  const text = SNIFF_DECODER.decode(head.subarray(start)).replace(/^\s+/, '');
  if (text.startsWith('<?xml') || text.startsWith('<cryo')) {
    return 'xml';
  }
  return 'unknown';
}
