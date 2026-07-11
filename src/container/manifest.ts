/**
 * manifest — the mandatory first entry (`manifest.json`) of a cryo container.
 *
 * Being first means its header sits at a fixed position, so the manifest is
 * readable without a full header scan (see MIGRATION-cryo-container.md §3).
 *
 * Validity contract (v2.1.0): a container is only valid if its manifest carries
 * all five required keys — `format`, `version`, `kind`, `name`, `contents`.
 * Only `entry` is optional (kinds without a single primary payload omit it).
 */

import { MANIFEST_SCHEMA_URL, validateManifestSchema } from './schema';

export const MANIFEST_PATH = 'manifest.json';
export const CONTAINER_FORMAT = 'cryo-container';
export const CONTAINER_VERSION = '2.1.0';

/** A logical role for a container entry (informational; not enforced). */
export type ContentType = 'scene' | 'script' | 'asset' | 'compiled' | 'meta' | 'other';

/**
 * Semantic category of a container — the discriminator Kosmos dispatches on.
 * Known kinds are suggested; the string stays open for future kinds. Do not
 * confuse this with `CryoKind` in sniff.ts (the physical xml-vs-tar axis).
 */
export type ContainerKind =
  | 'scene'
  | 'material'
  | 'shader'
  | 'asset-pack'
  | 'prefab'
  | 'scene-db'
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

export interface ContentEntry {
  /** Relative, forward-slash path within the container. */
  path: string;
  type: ContentType;
  size: number;
  /** Hex sha256 of the entry body (optional; written by `flush`/`pack`). */
  sha256?: string;
}

export interface ContainerManifest {
  /** Optional. Reference to the published JSON Schema (enables editor checks). */
  $schema?: string;
  /** Required. Must equal `cryo-container`. */
  format: string;
  /** Required. Container format version, e.g. '2.1.0'. */
  version: string;
  /** Required. Semantic category Kosmos dispatches on. */
  kind: ContainerKind;
  /** Required. Human-readable container name. */
  name: string;
  /** Required. Entry inventory (may be empty, but the key must be present). */
  contents: ContentEntry[];
  /** Optional. Path of the primary payload, e.g. 'scenes/main.cryo.xml'. */
  entry?: string;
  /**
   * Optional. Link to a preview image — either a container-internal path
   * (e.g. '.kosmos/preview.png') or an external URL. Used by Kosmos for
   * thumbnails without opening the payload.
   */
  preview?: string;
}

/** Build a fresh, minimal-but-valid manifest of the given kind. */
export function createManifest(
  kind: ContainerKind,
  name: string,
  entry?: string
): ContainerManifest {
  return {
    $schema: MANIFEST_SCHEMA_URL,
    format: CONTAINER_FORMAT,
    version: CONTAINER_VERSION,
    kind,
    name,
    contents: [],
    ...(entry !== undefined ? { entry } : {}),
  };
}

/** Optional string fields copied through verbatim when validation passes. */
const OPTIONAL_STRING_FIELDS = ['$schema', 'entry', 'preview'] as const;

/**
 * Parse and validate a manifest JSON string. Throws unless all five required
 * keys are present and well-typed. `entry`, when present, must be a string.
 */
export function parseManifest(json: string): ContainerManifest {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch (err) {
    throw new Error(`Invalid manifest.json: ${(err as Error).message}`);
  }

  const errors = validateManifest(obj);
  if (errors.length > 0) {
    throw new Error(`Invalid cryo manifest: ${errors.join('; ')}`);
  }

  const m = obj as ContainerManifest;
  const out: ContainerManifest = {
    format: m.format,
    version: m.version,
    kind: m.kind,
    name: m.name,
    contents: m.contents,
  };
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (m[field] !== undefined) out[field] = m[field];
  }
  return out;
}

/**
 * Structural validation of a parsed manifest object against the published JSON
 * Schema (see schema.ts). Returns a list of human-readable problems; an empty
 * list means the manifest is valid. Exported so callers (CLI `validate`, Kosmos
 * import) can report every problem at once.
 */
export function validateManifest(obj: unknown): string[] {
  return validateManifestSchema(obj);
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
