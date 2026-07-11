/**
 * manifest — the mandatory first entry (`manifest.json`) of a cryo container.
 *
 * Being first means its header sits at a fixed position, so the manifest is
 * readable without a full header scan (see MIGRATION-cryo-container.md §3).
 */

export const MANIFEST_PATH = 'manifest.json';
export const CONTAINER_FORMAT = 'cryo-container';
export const CONTAINER_VERSION = '2.0.0';

/** A logical role for a container entry (informational; not enforced). */
export type ContentType = 'scene' | 'script' | 'asset' | 'compiled' | 'meta' | 'other';

export interface ContentEntry {
  /** Relative, forward-slash path within the container. */
  path: string;
  type: ContentType;
  size: number;
  /** Hex sha256 of the entry body (optional; written by `flush`/`pack`). */
  sha256?: string;
}

export interface ContainerManifest {
  format: string; // 'cryo-container'
  version: string; // e.g. '2.0.0'
  /** Path of the primary scene entry, e.g. 'scenes/main.cryo.xml'. */
  entry: string;
  name?: string;
  contents: ContentEntry[];
}

/** Build a fresh, minimal manifest for the given entry path. */
export function createManifest(entry: string, name?: string): ContainerManifest {
  return {
    format: CONTAINER_FORMAT,
    version: CONTAINER_VERSION,
    entry,
    name,
    contents: [],
  };
}

/** Parse and validate a manifest JSON string. */
export function parseManifest(json: string): ContainerManifest {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch (err) {
    throw new Error(`Invalid manifest.json: ${(err as Error).message}`);
  }
  const m = obj as Partial<ContainerManifest>;
  if (!m || m.format !== CONTAINER_FORMAT) {
    throw new Error(`Not a cryo container: manifest.format !== '${CONTAINER_FORMAT}'`);
  }
  if (typeof m.entry !== 'string') {
    throw new Error('Invalid manifest: missing "entry"');
  }
  return {
    format: m.format,
    version: m.version ?? CONTAINER_VERSION,
    entry: m.entry,
    name: m.name,
    contents: Array.isArray(m.contents) ? m.contents : [],
  };
}

/** Serialize a manifest to pretty JSON. */
export function serializeManifest(manifest: ContainerManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/** Infer a logical content type from a path (best-effort). */
export function inferContentType(path: string): ContentType {
  if (path === MANIFEST_PATH || path.startsWith('.kosmos/')) return 'meta';
  if (path.startsWith('scenes/') || path.endsWith('.cryo.xml')) return 'scene';
  if (path.startsWith('scripts/') || path.endsWith('.lua')) return 'script';
  if (path.startsWith('compiled/')) return 'compiled';
  if (path.startsWith('assets/')) return 'asset';
  return 'other';
}
