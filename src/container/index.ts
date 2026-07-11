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
  sha256Hex,
} from './reader';
export type { OpenOptions } from './reader';

export { packFolder } from './writer';
export type { PackOptions } from './writer';

export {
  MANIFEST_PATH,
  CONTAINER_FORMAT,
  CONTAINER_VERSION,
  createManifest,
  parseManifest,
  serializeManifest,
  inferContentType,
} from './manifest';
export type {
  ContainerManifest,
  ContentEntry,
  ContentType,
} from './manifest';

export { sniffFile, sniffBytes } from './sniff';
export type { CryoKind } from './sniff';

export {
  scanTarBuffer,
  scanTarFd,
  encodeTar,
  encodeTarEntry,
  TAR_BLOCK,
} from './tar-index';
export type { TarIndex, IndexEntry, TarEntryType } from './tar-index';
