/**
 * reader — `CryoContainer`, the API analogue of a SQLite handle.
 *
 * The container reads through a `RandomAccessSource` (source.ts): scan the tar
 * header index once, then serve entries by positioned reads. Nothing is unpacked
 * to disk/memory. `fs` lives only in `FsSource`; the same class runs over a
 * `MemorySource` (isomorphic — see fromBuffer). The write path (`put`/`remove`/
 * `flush`) buffers changes and atomically replaces the whole backing on `flush`
 * (tar has no in-place variable-size insert), while reads stay random-access.
 */

import type { Readable } from 'stream';

import {
  IndexEntry,
  TarIndex,
  scanTarSource,
  encodeTar,
} from './tar-index';
import {
  ContainerManifest,
  ContentEntry,
  MANIFEST_PATH,
  createManifest,
  inferContentType,
  parseManifest,
  serializeManifest,
} from './manifest';
import {
  RandomAccessSource,
  MemorySource,
  isWritableSource,
} from './source';
import { FsSource } from './fs-source';
import { Hasher, sha256Hex } from './sha256';

const TEXT = new TextDecoder('utf-8');

/** Reject absolute paths, `..` traversal and back-slashes (§3 guard). */
function assertSafePath(path: string): void {
  if (path === '' || path.startsWith('/') || path.includes('\\') || /(^|\/)\.\.(\/|$)/.test(path)) {
    throw new Error(`Unsafe container path: ${path}`);
  }
}

export interface OpenOptions {
  /** Hasher for sha256 on write. Defaults to Node crypto; pass undefined to skip. */
  hasher?: Hasher;
}

export class CryoContainer {
  readonly source: RandomAccessSource;
  private index: TarIndex;
  private _manifest: ContainerManifest;
  private hasher?: Hasher;
  private closed = false;

  /** Pending writes: value = bytes to put, or null = remove. */
  private pending = new Map<string, Uint8Array | null>();

  private constructor(
    source: RandomAccessSource,
    index: TarIndex,
    manifest: ContainerManifest,
    hasher?: Hasher
  ) {
    this.source = source;
    this.index = index;
    this._manifest = manifest;
    this.hasher = hasher;
  }

  /** Node convenience: open a file path, backed by fs positioned reads. */
  static async open(path: string, opts: OpenOptions = {}): Promise<CryoContainer> {
    const source = await FsSource.open(path);
    try {
      return await CryoContainer.fromSource(source, {
        hasher: 'hasher' in opts ? opts.hasher : sha256Hex,
      });
    } catch (err) {
      await source.close();
      throw err;
    }
  }

  /** Open an in-memory container (isomorphic — the browser path). */
  static fromBuffer(bytes: Uint8Array | ArrayBuffer, opts: OpenOptions = {}): Promise<CryoContainer> {
    return CryoContainer.fromSource(new MemorySource(bytes), opts);
  }

  /** Open over any random-access source: one scan, manifest read from entry #1. */
  static async fromSource(source: RandomAccessSource, opts: OpenOptions = {}): Promise<CryoContainer> {
    const index = await scanTarSource(source);
    const manifestEntry = index.get(MANIFEST_PATH);
    let manifest: ContainerManifest;
    if (manifestEntry) {
      const buf = await source.read(manifestEntry.offset, manifestEntry.size);
      manifest = parseManifest(TEXT.decode(buf));
    } else {
      // Tolerate a container without a manifest: synthesize a minimal, valid one
      // (a manifest-less container is invalid per the v2.1.0 contract, but reads
      // stay best-effort). Assume the historical 'scene' kind.
      manifest = createManifest('scene', 'container');
    }
    return new CryoContainer(source, index, manifest, opts.hasher);
  }

  get manifest(): ContainerManifest {
    return this._manifest;
  }

  /** All entries as ContentEntry[] (index + manifest sha256 when present). */
  list(): ContentEntry[] {
    const shaByPath = new Map(this._manifest.contents.map((c) => [c.path, c.sha256]));
    const out: ContentEntry[] = [];
    for (const [path, entry] of this.effectiveEntries()) {
      out.push({
        path,
        type: inferContentType(path),
        size: entry.size,
        sha256: shaByPath.get(path),
      });
    }
    return out;
  }

  has(path: string): boolean {
    if (this.pending.has(path)) return this.pending.get(path) !== null;
    return this.index.has(path);
  }

  /** Read an entry body as bytes — seek+read, no unpacking. */
  async read(path: string): Promise<Uint8Array> {
    this.assertOpen();
    if (this.pending.has(path)) {
      const pend = this.pending.get(path);
      if (pend === null) throw new Error(`Entry removed: ${path}`);
      return pend!;
    }
    const entry = this.index.get(path);
    if (!entry) throw new Error(`Entry not found: ${path}`);
    if (entry.size === 0) return new Uint8Array(0);
    return this.source.read(entry.offset, entry.size);
  }

  /** Read an entry body as UTF-8 text. */
  async readText(path: string): Promise<string> {
    return TEXT.decode(await this.read(path));
  }

  /**
   * Stream an entry body. Uses the source's zero-copy byte-range stream when
   * available (fs); otherwise falls back to a one-shot read (isomorphic).
   */
  stream(path: string): Readable {
    this.assertOpen();
    // Lazy require so the browser bundle (which never streams) needs no 'stream'.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Readable } = require('stream') as typeof import('stream');
    if (this.pending.has(path)) {
      const pend = this.pending.get(path);
      if (pend === null) throw new Error(`Entry removed: ${path}`);
      return Readable.from(pend!);
    }
    const entry = this.index.get(path);
    if (!entry) throw new Error(`Entry not found: ${path}`);
    if (entry.size === 0) return Readable.from(new Uint8Array(0));
    if (this.source.streamRange) {
      return this.source.streamRange(entry.offset, entry.offset + entry.size);
    }
    const self = this;
    return Readable.from((async function* () {
      yield await self.read(path);
    })());
  }

  // -- Write path (buffered; committed by flush) ---------------------------

  /** Stage an entry write. Takes effect in the backing only after `flush`. */
  async put(path: string, data: Uint8Array | string): Promise<void> {
    this.assertOpen();
    assertSafePath(path);
    this.pending.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  }

  /** Stage an entry removal. Takes effect only after `flush`. */
  async remove(path: string): Promise<void> {
    this.assertOpen();
    if (!this.has(path)) throw new Error(`Cannot remove missing entry: ${path}`);
    this.pending.set(path, null);
  }

  /** True if there are un-flushed writes. */
  get dirty(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Commit staged writes: rebuild the tar (manifest first, sha256 recomputed via
   * the hasher when present), atomically replace the backing, then rescan.
   * Requires a writable source. Reads before/after stay random-access.
   */
  async flush(): Promise<void> {
    this.assertOpen();
    if (this.pending.size === 0) return;
    if (!isWritableSource(this.source)) {
      throw new Error('CryoContainer: source is read-only; cannot flush');
    }

    // Materialize the full, ordered set of entries (manifest regenerated first).
    const bodies = new Map<string, Uint8Array>();
    const order: string[] = [];
    for (const [path] of this.effectiveEntries()) {
      if (path === MANIFEST_PATH) continue;
      bodies.set(path, await this.read(path));
      order.push(path);
    }

    const contents: ContentEntry[] = order.map((path) => {
      const body = bodies.get(path)!;
      const entry: ContentEntry = { path, type: inferContentType(path), size: body.length };
      if (this.hasher) entry.sha256 = this.hasher(body);
      return entry;
    });
    const manifest: ContainerManifest = { ...this._manifest, contents };

    const entries: Array<[string, Uint8Array | string]> = [
      [MANIFEST_PATH, serializeManifest(manifest)],
      ...order.map((p): [string, Uint8Array] => [p, bodies.get(p)!]),
    ];
    const tar = encodeTar(entries);

    await this.source.replaceAll(tar);
    this.index = await scanTarSource(this.source);
    this._manifest = manifest;
    this.pending.clear();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.source.close().catch(() => undefined);
  }

  // -- Convenience ----------------------------------------------------------

  /** Read + parse the primary scene entry using the existing XML parser. */
  async parseScene(): Promise<import('../parser').ParseResult> {
    const entry = this._manifest.entry;
    if (!entry) throw new Error('Container manifest has no scene entry');
    const xml = await this.readText(entry);
    // Lazy import to avoid a container↔parser require cycle at module load.
    const { parse } = await import('../parser');
    return parse(xml);
  }

  // -- Internals ------------------------------------------------------------

  /** Index merged with pending writes, preserving physical order + additions. */
  private effectiveEntries(): Array<[string, IndexEntry]> {
    const merged = new Map<string, IndexEntry>(this.index);
    for (const [path, val] of this.pending) {
      if (val === null) {
        merged.delete(path);
      } else {
        merged.set(path, { offset: -1, size: val.length, type: 'file' });
      }
    }
    return [...merged.entries()];
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('CryoContainer is closed');
  }
}

/** Open a container from a file path. Thin Node convenience over `open`. */
export function openContainer(path: string, opts?: OpenOptions): Promise<CryoContainer> {
  return CryoContainer.open(path, opts);
}
