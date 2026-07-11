/**
 * @cryo/cryojs container submodule — `.cryo` as a random-access tar container.
 *
 * See docs/MIGRATION-cryo-container.md. The `.cryo` extension is overloaded:
 * legacy XML files stay readable (`sniff`), new files are seekable tar
 * containers opened as a handle (`openContainer`) — never unpacked to disk.
 */

export {
  CryoContainer,
  openContainer,
} from './reader';
export type { OpenOptions } from './reader';

export { sha256Hex } from './sha256';
export type { Hasher } from './sha256';

export { MemorySource, isWritableSource } from './source';
export type { RandomAccessSource, WritableSource } from './source';
export { FsSource } from './fs-source';

export { packFolder } from './writer';
export type { PackOptions } from './writer';

export {
  MANIFEST_PATH,
  CONTAINER_FORMAT,
  CONTAINER_VERSION,
  createManifest,
  parseManifest,
  serializeManifest,
  validateManifest,
  inferContentType,
} from './manifest';
export type {
  ContainerManifest,
  ContainerKind,
  ContentEntry,
  ContentType,
} from './manifest';

export {
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_URL,
  KNOWN_KINDS,
  validateManifestSchema,
  validateKindSchema,
} from './schema';

export { sniffBytes } from './sniff';
export type { CryoKind } from './sniff';
export { sniffFile } from './sniff-file';

export { inspectBytes, entryBytes } from './report';
export type { CryoReport, EntryInfo, ReportMessage } from './report';

export {
  scanTarBuffer,
  scanTarSource,
  encodeTar,
  encodeTarEntry,
  TAR_BLOCK,
} from './tar-index';
export type { TarIndex, IndexEntry, TarEntryType } from './tar-index';
