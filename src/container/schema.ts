/**
 * schema — the JSON Schema for `.cryo` (the `manifest.json` envelope, with the
 * per-kind structural rules folded in as `allOf`/`if-then` conditionals), and
 * an ajv validator over it.
 *
 * One canonical file — `manifest.schema.json` — bundled so validation is offline
 * and network-free. The identical file is published at
 * `https://chevp.github.io/cryojs/schema/manifest.schema.json` (mirror in
 * `docs/schema/`, kept in sync by `npm run schema:publish`). New manifests carry
 * a `$schema` pointer to that URL so editors validate them too.
 */

import Ajv2020, { ErrorObject, ValidateFunction } from 'ajv/dist/2020';

import manifestSchema from './manifest.schema.json';

/** The published `$id` of the manifest schema — the URL manifests reference. */
export const MANIFEST_SCHEMA_URL: string = (manifestSchema as { $id: string }).$id;

/** The manifest JSON Schema object (draft 2020-12); kind rules are `allOf` conditionals. */
export const MANIFEST_SCHEMA = manifestSchema;

/** Kinds with dedicated structural rules in the schema. */
export const KNOWN_KINDS = ['scene', 'material', 'shader', 'asset-pack'];

// Compiled lazily (on first validateManifest call), not at module load: ajv's
// codegen runs `new Function(...)`, which a strict CSP (e.g. Electron's
// `script-src 'self'` with no `unsafe-eval`) refuses to execute. Consumers that
// only want the tile registry (this file's exports sit behind the same
// `browser.ts` barrel) must be able to import this module without tripping
// that — an eager top-level `ajv.compile()` broke exactly that case.
let validator: ValidateFunction | undefined;
function getValidator(): ValidateFunction {
  if (!validator) validator = new Ajv2020({ allErrors: true, strict: false }).compile(manifestSchema);
  return validator;
}

/** Format one ajv error as `<path> <message>` (path relative to the manifest). */
function formatError(err: ErrorObject): string {
  const where = err.instancePath === '' ? '(root)' : err.instancePath;
  return `${where} ${err.message ?? 'is invalid'}`.trim();
}

/**
 * Validate a parsed manifest object against the schema — envelope rules plus the
 * conditional per-kind rules. Returns a list of human-readable problems; an
 * empty list means valid.
 */
export function validateManifest(obj: unknown): string[] {
  const v = getValidator();
  return v(obj) ? [] : (v.errors ?? []).map(formatError);
}

// Back-compat aliases: kind rules now live inside the one schema, so these all
// run the same validator.
export const validateManifestSchema = validateManifest;
export const validateKindSchema = validateManifest;
