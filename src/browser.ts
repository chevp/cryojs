/**
 * @cryo/cryojs/browser
 *
 * Everything here runs over plain `Uint8Array` (no fs, no Buffer, no crypto), so
 * a bundler emits a self-contained ESM module. The docs viewer (docs/js) imports
 * the BUNDLED form of this file instead of maintaining hand-written twins — one
 * source of truth for tar scanning, manifest validation and content typing.
 *
 * Node code should import from the package root ('@cryo/cryojs') instead, which
 * additionally exposes the fs-backed reader/writer.
 */

export { inspectBytes, entryBytes } from './container/report';
export type { CryoReport, EntryInfo, ReportMessage } from './container/report';

export { scanTarBuffer, scanTarSource, TAR_BLOCK } from './container/tar-index';
export type { TarIndex, IndexEntry } from './container/tar-index';

export { sniffBytes } from './container/sniff';
export type { CryoKind } from './container/sniff';

export {
  MANIFEST_PATH,
  inferContentType,
} from './container/manifest';
export type {
  ContainerManifest,
  ContainerKind,
  ContentEntry,
  ContentType,
} from './container/manifest';

export {
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_URL,
  KNOWN_KINDS,
  validateManifest,
} from './container/schema';

// In-memory random-access backing — pair with scanTarSource to seek+read entries
// out of an ArrayBuffer, the browser twin of Node's fs-backed positioned reads.
// (The full fs-backed CryoContainer lives at the package root, Node only.)
export { MemorySource } from './container/source';
