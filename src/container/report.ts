/**
 * report — isomorphic validity inspection of a `.cryo` from its raw bytes.
 *
 * One implementation for every consumer: the Node CLI and the browser viewer
 * (docs/js) both call `inspectBytes`. No fs, no Buffer — pure Uint8Array — so it
 * bundles for the browser unchanged. This is what replaced the hand-written
 * docs/js/validate.js twin.
 */

import { scanTarBuffer } from './tar-index';
import { sniffBytes } from './sniff';
import {
  ContainerManifest,
  MANIFEST_PATH,
  validateManifest,
} from './manifest';

export interface EntryInfo {
  path: string;
  size: number;
  /** Byte offset of the entry body within the container. */
  offset: number;
}

export interface ReportMessage {
  code: string;
  message: string;
}

export interface CryoReport {
  ok: boolean;
  errors: ReportMessage[];
  warnings: ReportMessage[];
  entries: EntryInfo[];
  /** Parsed manifest for display (best-effort; may be present even when invalid). */
  manifest: ContainerManifest | null;
}

const DECODER = new TextDecoder('utf-8');

/**
 * Inspect container bytes: is it a tar, does it carry a valid manifest.json (5
 * required keys + kind rules)? Lenient for display — entries and a best-effort
 * manifest are returned even when validity fails.
 */
export function inspectBytes(input: Uint8Array | ArrayBuffer): CryoReport {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const errors: ReportMessage[] = [];
  const warnings: ReportMessage[] = [];
  const entries: EntryInfo[] = [];

  // 1. Must be a tar container.
  if (sniffBytes(bytes.subarray(0, 512)) !== 'container') {
    errors.push({ code: 'not-tar', message: 'Not a cryo container (missing USTAR magic).' });
    return { ok: false, errors, warnings, entries, manifest: null };
  }

  // 2. Scan entries (lenient — a bad header just stops the scan).
  let index;
  try {
    index = scanTarBuffer(bytes);
  } catch (err) {
    errors.push({ code: 'bad-tar', message: `Corrupt tar: ${(err as Error).message}` });
    return { ok: false, errors, warnings, entries, manifest: null };
  }
  for (const [path, e] of index) {
    entries.push({ path, size: e.size, offset: e.offset });
  }

  // 3. Must carry manifest.json.
  const mEntry = index.get(MANIFEST_PATH);
  if (!mEntry) {
    errors.push({ code: 'manifest-missing', message: 'Missing required manifest.json.' });
    return { ok: false, errors, warnings, entries, manifest: null };
  }

  // 4. Parse + validate the manifest (best-effort parse for display).
  let manifest: ContainerManifest | null = null;
  let raw: unknown = null;
  try {
    raw = JSON.parse(DECODER.decode(bytes.subarray(mEntry.offset, mEntry.offset + mEntry.size)));
    manifest = raw as ContainerManifest;
  } catch (err) {
    errors.push({ code: 'manifest-json', message: `manifest.json is not valid JSON: ${(err as Error).message}` });
    return { ok: false, errors, warnings, entries, manifest: null };
  }

  for (const problem of validateManifest(raw)) {
    errors.push({ code: 'manifest-invalid', message: problem });
  }

  return { ok: errors.length === 0, errors, warnings, entries, manifest };
}

/** Slice one entry body out of the container bytes (seek+read, no copy). */
export function entryBytes(bytes: Uint8Array, entry: EntryInfo): Uint8Array {
  return bytes.subarray(entry.offset, entry.offset + entry.size);
}
