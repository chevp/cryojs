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

import type { RandomAccessSource } from './source';

/** tar operates in 512-byte blocks. */
export const TAR_BLOCK = 512;

/** Shared decoder for the small ASCII header fields (isomorphic). */
const DECODER = new TextDecoder('utf-8');

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

/** Parse an octal numeric tar field (may be space/NUL padded). Uint8Array-based. */
function parseOctal(block: Uint8Array, start: number, len: number): number {
  let s = '';
  for (let i = start; i < start + len; i++) {
    const c = block[i];
    if (c === 0 || c === 0x20) continue; // skip NUL / space padding
    s += String.fromCharCode(c);
  }
  s = s.trim();
  return s === '' ? 0 : parseInt(s, 8) || 0;
}

/** Read a NUL-terminated string field. Uint8Array-based. */
function parseString(block: Uint8Array, start: number, len: number): string {
  let end = start;
  const max = Math.min(start + len, block.length);
  while (end < max && block[end] !== 0) end++;
  return DECODER.decode(block.subarray(start, end));
}

/** True if the 512-byte block is entirely zero (tar end-of-archive marker). */
function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i++) {
    if (block[i] !== 0) return false;
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
function parseHeader(block: Uint8Array): ParsedHeader | null {
  if (isZeroBlock(block)) return null;

  const magic = parseString(block, USTAR_MAGIC_OFFSET, 5);
  if (magic !== USTAR_MAGIC) {
    throw new Error('bad magic at offset 257');
  }

  const name = parseString(block, 0, 100);
  const size = parseOctal(block, 124, 12);
  const typeByte = block[156];
  const prefix = parseString(block, 345, 155);

  let type: TarEntryType = 'other';
  if (typeByte === 0x30 || typeByte === 0 || typeByte === 0x20) type = 'file'; // '0', NUL, space
  else if (typeByte === 0x35) type = 'dir'; // '5'

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
export function scanTarBuffer(buf: Uint8Array): TarIndex {
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
 * Scan a tar via a `RandomAccessSource` without loading the whole file: read one
 * header block, seek past the body, repeat. This positioned-read scan is what
 * makes the container behave like a sqlite handle for large archives — and it
 * runs unchanged over any backing (fs, memory, browser Blob).
 */
export async function scanTarSource(source: RandomAccessSource): Promise<TarIndex> {
  const index: TarIndex = new Map();
  const fileSize = source.size;
  let pos = 0;

  while (pos + TAR_BLOCK <= fileSize) {
    const block = await source.read(pos, TAR_BLOCK);
    if (block.length < TAR_BLOCK) break;
    const parsed = parseHeader(block);
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
export function encodeTarEntry(path: string, data: Uint8Array | string): Buffer {
  const body = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data);
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
export function encodeTar(entries: Array<[string, Uint8Array | string]>): Buffer {
  const parts: Buffer[] = entries.map(([p, d]) => encodeTarEntry(p, d));
  // Two zero blocks mark end-of-archive.
  parts.push(Buffer.alloc(TAR_BLOCK * 2));
  return Buffer.concat(parts);
}
