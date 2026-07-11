/**
 * sniff — distinguish a legacy XML `.cryo` from a tar `.cryo` container.
 *
 * Backwards-compat cornerstone (MIGRATION-cryo-container.md §4.3): one file
 * extension, one icon. We peek the leading bytes rather than trust the name.
 */

import { open, read as fsRead, close } from 'fs';
import { promisify } from 'util';

const openAsync = promisify(open);
const closeAsync = promisify(close);
const readAsync = promisify(fsRead) as unknown as (
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number
) => Promise<{ bytesRead: number; buffer: Buffer }>;

export type CryoKind = 'xml' | 'container' | 'unknown';

// A USTAR header carries the magic "ustar" at offset 257. We read 512 bytes so
// the check works whether we get a buffer or a file.
const SNIFF_LEN = 512;

/** Classify already-read leading bytes of a `.cryo` file. */
export function sniffBytes(head: Buffer): CryoKind {
  if (head.length >= 262 && head.toString('ascii', 257, 262) === 'ustar') {
    return 'container';
  }
  // Skip a UTF-8 BOM if present, then look for an XML/cryo opening.
  let start = 0;
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    start = 3;
  }
  const text = head.toString('utf-8', start).replace(/^\s+/, '');
  if (text.startsWith('<?xml') || text.startsWith('<cryo')) {
    return 'xml';
  }
  return 'unknown';
}

/** Classify a `.cryo` file on disk by peeking its first block. */
export async function sniffFile(path: string): Promise<CryoKind> {
  const fd = await openAsync(path, 'r');
  try {
    const buf = Buffer.alloc(SNIFF_LEN);
    const { bytesRead } = await readAsync(fd, buf, 0, SNIFF_LEN, 0);
    return sniffBytes(buf.subarray(0, bytesRead));
  } finally {
    await closeAsync(fd);
  }
}
