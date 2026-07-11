/**
 * sniff-file — the Node (fs) path of sniffing. Kept separate from sniff.ts so
 * the pure `sniffBytes` stays isomorphic and the browser bundle never pulls fs.
 */

import { open, read as fsRead, close } from 'fs';
import { promisify } from 'util';

import { CryoKind, sniffBytes } from './sniff';

const openAsync = promisify(open);
const closeAsync = promisify(close);
const readAsync = promisify(fsRead) as unknown as (
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number
) => Promise<{ bytesRead: number; buffer: Buffer }>;

const SNIFF_LEN = 512;

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
