/**
 * validate.js — validity check for a `.cryo` container.
 *
 * A `.cryo` is valid when BOTH hold:
 *   1. it is a tar archive (USTAR magic), and
 *   2. it contains a `manifest.json` entry.
 *
 * Returns { ok, errors, warnings, entries, manifest }. `manifest` is parsed
 * best-effort for display and does not affect validity.
 */

const BLOCK = 512;
const MANIFEST_PATH = 'manifest.json';
const decoder = new TextDecoder('utf-8');

function field(bytes, start, len) {
  let end = start;
  const max = Math.min(start + len, bytes.length);
  while (end < max && bytes[end] !== 0) end++;
  return decoder.decode(bytes.subarray(start, end));
}

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

function isZeroBlock(bytes, start) {
  for (let i = start; i < start + BLOCK; i++) if (bytes[i] !== 0) return false;
  return true;
}

export function validateCryo(arrayBuffer) {
  const errors = [];
  const bytes = new Uint8Array(arrayBuffer);
  const entries = [];

  // 1. Must be a tar: USTAR magic in the first header block.
  const isTar = bytes.length >= 262 && field(bytes, 257, 5) === 'ustar';
  if (!isTar) {
    errors.push({ code: 'not-tar', message: 'Not a cryo container.' });
  } else {
    // Walk the headers to collect entry paths.
    let pos = 0;
    while (pos + BLOCK <= bytes.length) {
      if (isZeroBlock(bytes, pos)) break;
      if (field(bytes, pos + 257, 5) !== 'ustar') break;
      const name = field(bytes, pos, 100);
      const prefix = field(bytes, pos + 345, 155);
      const path = prefix ? `${prefix}/${name}` : name;
      const size = octal(bytes, pos + 124, 12);
      const typeflag = bytes[pos + 156];
      if (typeflag === 48 || typeflag === 0) {
        entries.push({ path, size, offset: pos + BLOCK });
      }
      pos = pos + BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    }
  }

  // 2. Must contain manifest.json.
  const mEntry = entries.find((e) => e.path === MANIFEST_PATH);
  if (isTar && !mEntry) {
    errors.push({ code: 'manifest-missing', message: 'Missing required manifest.json.' });
  }

  // Parse the manifest for display only (invalid JSON does not fail validity).
  let manifest = null;
  if (mEntry) {
    try {
      manifest = JSON.parse(decoder.decode(bytes.subarray(mEntry.offset, mEntry.offset + mEntry.size)));
    } catch {
      manifest = null;
    }
  }

  return { ok: errors.length === 0, errors, warnings: [], entries, manifest };
}
