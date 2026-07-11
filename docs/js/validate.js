/**
 * validate.js — strict validator for a `.cryo` container.
 *
 * Two layers:
 *   1. Tar structure — walk the archive block by block and verify it really is
 *      a well-formed uncompressed USTAR (magic, header checksums, numeric
 *      fields, body lengths, end-of-archive marker). This catches files that
 *      merely *look* like a container to the lenient reader.
 *   2. Container rules — manifest.json must be the first entry, be valid JSON
 *      with format 'cryo-container' + an `entry`, that entry must exist, paths
 *      must be safe, and (if the manifest lists sha256) bodies must match.
 *
 * Returns { ok, errors, warnings, entries, manifest } — `errors` are fatal,
 * `warnings` are advisory. Async because sha256 uses SubtleCrypto.
 */

const BLOCK = 512;
const MANIFEST_PATH = 'manifest.json';
const decoder = new TextDecoder('utf-8');

function field(bytes, start, len) {
  let end = start;
  const max = start + len;
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
  if (s === '') return 0;
  const n = parseInt(s, 8);
  return Number.isNaN(n) ? NaN : n;
}

function isZeroBlock(bytes, start) {
  for (let i = start; i < start + BLOCK; i++) if (bytes[i] !== 0) return false;
  return true;
}

/** USTAR header checksum: sum of bytes with the checksum field taken as spaces. */
function headerChecksum(bytes, start) {
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < BLOCK; i++) {
    const raw = bytes[start + i];
    const b = i >= 148 && i < 156 ? 0x20 : raw;
    unsigned += b;
    signed += b < 128 ? b : b - 256; // some historical writers used signed bytes
  }
  return { unsigned, signed };
}

function unsafePath(p) {
  return (
    p === '' ||
    p.startsWith('/') ||
    p.includes('\\') ||
    /(^|\/)\.\.(\/|$)/.test(p) ||
    /^[A-Za-z]:/.test(p)
  );
}

async function sha256Hex(view) {
  // Copy into a standalone ArrayBuffer (view may be a subarray of a larger one).
  const buf = view.slice().buffer;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function validateCryo(arrayBuffer) {
  const errors = [];
  const warnings = [];
  const err = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });

  const bytes = new Uint8Array(arrayBuffer);

  // -- Layer 1: tar structure ------------------------------------------------
  if (bytes.length === 0) {
    err('empty', 'File is empty.');
    return { ok: false, errors, warnings, entries: [], manifest: null };
  }
  if (bytes.length % BLOCK !== 0) {
    err('size', `Length ${bytes.length} is not a multiple of ${BLOCK} — not a valid tar.`);
  }

  const entries = [];
  let pos = 0;
  let sawEndMarker = false;

  while (pos + BLOCK <= bytes.length) {
    if (isZeroBlock(bytes, pos)) {
      sawEndMarker = true;
      break; // first zero block ends the archive
    }

    const magic = field(bytes, pos + 257, 5);
    if (magic !== 'ustar') {
      err('magic', `Missing USTAR magic at block offset ${pos} (got "${magic}").`);
      break;
    }

    // Checksum
    const stored = octal(bytes, pos + 148, 8);
    const { unsigned, signed } = headerChecksum(bytes, pos);
    if (Number.isNaN(stored)) {
      err('checksum', `Header at ${pos} has a non-octal checksum field.`);
    } else if (stored !== unsigned && stored !== signed) {
      err('checksum', `Header checksum mismatch at ${pos} (stored ${stored}, computed ${unsigned}).`);
    }

    const name = field(bytes, pos, 100);
    const prefix = field(bytes, pos + 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const size = octal(bytes, pos + 124, 12);
    const typeflag = String.fromCharCode(bytes[pos + 156] || 48);

    if (Number.isNaN(size)) {
      err('size-field', `Entry "${path}" has a non-octal size field.`);
      break;
    }
    const bodyOffset = pos + BLOCK;
    if (bodyOffset + size > bytes.length) {
      err('truncated', `Entry "${path}" claims ${size} bytes but the file is truncated.`);
      break;
    }
    if (unsafePath(path)) {
      err('unsafe-path', `Unsafe entry path: "${path}".`);
    }

    if (typeflag === '0' || typeflag === '\0' || bytes[pos + 156] === 0) {
      entries.push({ path, size, offset: bodyOffset });
    }
    pos = bodyOffset + Math.ceil(size / BLOCK) * BLOCK;
  }

  if (!sawEndMarker) {
    warn('no-end-marker', 'No zero-block end-of-archive marker found.');
  }
  if (entries.length === 0) {
    err('no-entries', 'Container has no file entries.');
    return { ok: errors.length === 0, errors, warnings, entries, manifest: null };
  }

  // -- Layer 2: container rules ---------------------------------------------
  if (entries[0].path !== MANIFEST_PATH) {
    err('manifest-first', `First entry must be "${MANIFEST_PATH}" (got "${entries[0].path}").`);
  }

  const mEntry = entries.find((e) => e.path === MANIFEST_PATH);
  let manifest = null;
  if (!mEntry) {
    err('manifest-missing', `Required entry "${MANIFEST_PATH}" is absent.`);
  } else {
    const text = decoder.decode(bytes.subarray(mEntry.offset, mEntry.offset + mEntry.size));
    try {
      manifest = JSON.parse(text);
    } catch (e) {
      err('manifest-json', `manifest.json is not valid JSON: ${e.message}`);
    }
  }

  if (manifest) {
    if (manifest.format !== 'cryo-container') {
      err('format', `manifest.format must be "cryo-container" (got "${manifest.format}").`);
    }
    if (typeof manifest.version !== 'string') {
      warn('version', 'manifest.version is missing or not a string.');
    }
    if (typeof manifest.entry !== 'string' || manifest.entry === '') {
      err('entry', 'manifest.entry (the scene path) is missing.');
    } else if (!entries.some((e) => e.path === manifest.entry)) {
      err('entry-missing', `manifest.entry "${manifest.entry}" is not present in the container.`);
    }

    // Verify declared contents (size + sha256) against the real bodies.
    const byPath = new Map(entries.map((e) => [e.path, e]));
    for (const c of manifest.contents || []) {
      const e = byPath.get(c.path);
      if (!e) {
        warn('content-missing', `manifest.contents lists "${c.path}" but it is not in the archive.`);
        continue;
      }
      if (typeof c.size === 'number' && c.size !== e.size) {
        warn('size-mismatch', `"${c.path}" size ${e.size} ≠ manifest ${c.size}.`);
      }
      if (c.sha256) {
        const actual = await sha256Hex(bytes.subarray(e.offset, e.offset + e.size));
        if (actual !== c.sha256) {
          err('sha256', `"${c.path}" sha256 mismatch (expected ${c.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…).`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, entries, manifest };
}
