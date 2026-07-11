/**
 * tar-index — the "sqlite-index" of a cryo container.
 *
 * A `.cryo` container is an *uncompressed* USTAR tar. This module owns the
 * low-level tar format: a one-time header scan that yields
 * `Map<path, { offset, size, type }>` (so every subsequent read is a plain
 * `fs.read(fd, buf, 0, size, offset)`), plus the encoders used to (re)write a
 * container.
 *
 * We roll our own reader/writer rather than depend on `tar`: the read path only
 * needs a header scan + positioned reads, which keeps the offset-index cache
 * trivial and avoids a runtime dependency (see MIGRATION-cryo-container.md §4.5).
 */

import { read as fsRead } from 'fs';
import { promisify } from 'util';

const readAsync = promisify(fsRead) as unknown as (
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number
) => Promise<{ bytesRead: number; buffer: Buffer }>;

/** tar operates in 512-byte blocks. */
export const TAR_BLOCK = 512;

/** USTAR magic lives at offset 257 of every header block. */
const USTAR_MAGIC = 'ustar';
const USTAR_MAGIC_OFFSET = 257;

/** Entry kinds we care about (typeflag). */
export type TarEntryType = 'file' | 'dir' | 'other';

export interface IndexEntry {
  /** Byte offset of the entry *body* (not its header) within the tar. */
  offset: number;
  /** Byte length of the entry body. */
  size: number;
  type: TarEntryType;
}

export type TarIndex = Map<string, IndexEntry>;

// ============================================================================
// Decoding
// ============================================================================

/** Round `n` up to the next 512-byte block boundary. */
export function roundUp(n: number): number {
  return Math.ceil(n / TAR_BLOCK) * TAR_BLOCK;
}

/** Parse an octal numeric tar field (may be space/NUL padded). */
function parseOctal(buf: Buffer, start: number, len: number): number {
  let s = buf.toString('ascii', start, start + len);
  // Trim NULs and spaces; empty → 0.
  s = s.replace(/[\0 ]+$/g, '').replace(/^[\0 ]+/g, '').trim();
  if (s === '') return 0;
  return parseInt(s, 8) || 0;
}

/** Read a NUL-terminated ASCII string field. */
function parseString(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return slice.toString('utf-8', 0, nul === -1 ? slice.length : nul);
}

/** True if the 512-byte block is entirely zero (tar end-of-archive marker). */
function isZeroBlock(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

interface ParsedHeader {
  name: string;
  size: number;
  type: TarEntryType;
  prefix: string;
}

/** Parse a single 512-byte USTAR header block. Returns null for a zero block. */
function parseHeader(block: Buffer): ParsedHeader | null {
  if (isZeroBlock(block)) return null;

  const magic = block.toString('ascii', USTAR_MAGIC_OFFSET, USTAR_MAGIC_OFFSET + 5);
  if (magic !== USTAR_MAGIC) {
    throw new Error('bad magic at offset 257');
  }

  const name = parseString(block, 0, 100);
  const size = parseOctal(block, 124, 12);
  const typeflag = block.toString('ascii', 156, 157);
  const prefix = parseString(block, 345, 155);

  let type: TarEntryType = 'other';
  if (typeflag === '0' || typeflag === '\0' || typeflag === '') type = 'file';
  else if (typeflag === '5') type = 'dir';

  return { name, size, type, prefix };
}

/** Join USTAR `prefix` + `name` into a full path. */
function fullPath(h: ParsedHeader): string {
  return h.prefix ? `${h.prefix}/${h.name}` : h.name;
}

/**
 * Scan a whole tar buffer into an offset index.
 * The insertion order of the returned Map matches the tar's physical order.
 */
export function scanTarBuffer(buf: Buffer): TarIndex {
  const index: TarIndex = new Map();
  let pos = 0;

  while (pos + TAR_BLOCK <= buf.length) {
    const header = parseHeader(buf.subarray(pos, pos + TAR_BLOCK));
    if (header === null) break; // end-of-archive
    const bodyOffset = pos + TAR_BLOCK;
    const path = fullPath(header);
    if (header.type === 'file') {
      index.set(path, { offset: bodyOffset, size: header.size, type: 'file' });
    }
    pos = bodyOffset + roundUp(header.size);
  }

  return index;
}

/**
 * Scan a tar via an open file descriptor without loading the whole file.
 * Reads one header block, seeks past the body, repeats — this is what makes
 * the container behave like a sqlite handle for large archives.
 */
export async function scanTarFd(fd: number, fileSize: number): Promise<TarIndex> {
  const index: TarIndex = new Map();
  let pos = 0;
  const header = Buffer.alloc(TAR_BLOCK);

  while (pos + TAR_BLOCK <= fileSize) {
    const { bytesRead } = await readAsync(fd, header, 0, TAR_BLOCK, pos);
    if (bytesRead < TAR_BLOCK) break;
    const parsed = parseHeader(header);
    if (parsed === null) break; // end-of-archive
    const bodyOffset = pos + TAR_BLOCK;
    const path = fullPath(parsed);
    if (parsed.type === 'file') {
      index.set(path, { offset: bodyOffset, size: parsed.size, type: 'file' });
    }
    pos = bodyOffset + roundUp(parsed.size);
  }

  return index;
}

// ============================================================================
// Encoding
// ============================================================================

/** Write an octal numeric field, NUL-terminated, right-aligned in `len`. */
function writeOctal(block: Buffer, value: number, start: number, len: number): void {
  // len-1 digits + trailing NUL, zero-padded.
  const str = value.toString(8).padStart(len - 1, '0');
  block.write(str + '\0', start, len, 'ascii');
}

/** Compute the USTAR header checksum (sum of bytes, checksum field as spaces). */
function computeChecksum(block: Buffer): number {
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) {
    // Checksum field (148..156) counted as ASCII spaces during computation.
    sum += i >= 148 && i < 156 ? 0x20 : block[i];
  }
  return sum;
}

/** Split a path into USTAR name (≤100) / prefix (≤155). Throws if too long. */
function splitPath(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' };
  // Find a split point on a '/' so name ≤100 and prefix ≤155.
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i] !== '/') continue;
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) {
      return { name, prefix };
    }
  }
  throw new Error(`Path too long for USTAR (max 255 bytes): ${path}`);
}

/**
 * Encode one file entry (header + NUL-padded body) as tar blocks.
 * `data` may be a string (utf-8) or Buffer.
 */
export function encodeTarEntry(path: string, data: Buffer | string): Buffer {
  const body = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  const { name, prefix } = splitPath(path);

  const header = Buffer.alloc(TAR_BLOCK);
  header.write(name, 0, 100, 'utf-8');
  writeOctal(header, 0o644, 100, 8); // mode
  writeOctal(header, 0, 108, 8); // uid
  writeOctal(header, 0, 116, 8); // gid
  writeOctal(header, body.length, 124, 12); // size
  writeOctal(header, 0, 136, 12); // mtime — 0 for reproducible containers
  header.write('0', 156, 1, 'ascii'); // typeflag: regular file
  header.write(USTAR_MAGIC + '\0', USTAR_MAGIC_OFFSET, 6, 'ascii'); // "ustar\0"
  header.write('00', 263, 2, 'ascii'); // version
  if (prefix) header.write(prefix, 345, 155, 'utf-8');

  // Checksum: fill field with spaces, compute, then write octal + NUL + space.
  header.fill(0x20, 148, 156);
  const checksum = computeChecksum(header);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');

  const padded = roundUp(body.length);
  const bodyBlock = Buffer.alloc(padded);
  body.copy(bodyBlock);

  return Buffer.concat([header, bodyBlock]);
}

/** Build a complete tar from ordered [path, data] entries (+ end marker). */
export function encodeTar(entries: Array<[string, Buffer | string]>): Buffer {
  const parts: Buffer[] = entries.map(([p, d]) => encodeTarEntry(p, d));
  // Two zero blocks mark end-of-archive.
  parts.push(Buffer.alloc(TAR_BLOCK * 2));
  return Buffer.concat(parts);
}
