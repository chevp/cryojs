/**
 * Browser USTAR reader — the client-side twin of src/container/tar-index.ts.
 *
 * A `.cryo` container is an uncompressed USTAR tar. We scan its 512-byte headers
 * into an offset index, then slice entry bodies out of the ArrayBuffer on
 * demand — the same "open once, seek+read" model the Node API uses, no unpack.
 */

const BLOCK = 512;

function octal(bytes, start, len) {
  let s = '';
  for (let i = start; i < start + len; i++) {
    const c = bytes[i];
    if (c === 0 || c === 32) continue;
    s += String.fromCharCode(c);
  }
  s = s.trim();
  return s ? parseInt(s, 8) || 0 : 0;
}

function str(bytes, start, len) {
  let end = start;
  const max = start + len;
  while (end < max && bytes[end] !== 0) end++;
  return new TextDecoder('utf-8').decode(bytes.subarray(start, end));
}

function isZero(bytes, start) {
  for (let i = start; i < start + BLOCK; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

/**
 * Parse an ArrayBuffer into an ordered list of entries.
 * Returns { entries: [{ path, size, offset, type }], bytes } — `bytes` is the
 * Uint8Array view so callers can slice bodies without re-reading.
 */
export function readTar(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const entries = [];
  let pos = 0;

  while (pos + BLOCK <= bytes.length) {
    if (isZero(bytes, pos)) break; // end-of-archive
    const magic = str(bytes, pos + 257, 5);
    if (magic !== 'ustar') {
      throw new Error('Not a cryo container.');
    }
    const name = str(bytes, pos, 100);
    const size = octal(bytes, pos + 124, 12);
    const typeflag = String.fromCharCode(bytes[pos + 156] || 48);
    const prefix = str(bytes, pos + 345, 155);
    const path = prefix ? prefix + '/' + name : name;
    const bodyOffset = pos + BLOCK;

    if (typeflag === '0' || typeflag === '\0' || bytes[pos + 156] === 0) {
      entries.push({ path, size, offset: bodyOffset, type: 'file' });
    }
    pos = bodyOffset + Math.ceil(size / BLOCK) * BLOCK;
  }

  return { entries, bytes };
}

/** Slice one entry body out as a Uint8Array (seek+read, no copy of the rest). */
export function entryBytes(bytes, entry) {
  return bytes.subarray(entry.offset, entry.offset + entry.size);
}

/** Sniff whether an ArrayBuffer is a tar container or legacy XML .cryo. */
export function sniff(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer.slice(0, 512));
  if (b.length >= 262 && str(b, 257, 5) === 'ustar') return 'container';
  const text = new TextDecoder('utf-8').decode(b).replace(/^﻿?\s+/, '');
  if (text.startsWith('<?xml') || text.startsWith('<cryo')) return 'xml';
  return 'unknown';
}
