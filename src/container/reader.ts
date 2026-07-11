/**
 * reader — `CryoContainer`, the API analogue of a SQLite handle.
 *
 * Open the *one* file, keep its descriptor, scan the tar header index once, then
 * serve entries by positioned reads. Nothing is unpacked to disk
 * (MIGRATION-cryo-container.md §4.2). The write path (`put`/`remove`/`flush`)
 * buffers changes and rewrites the tar atomically on `flush` — tar has no true
 * in-place variable-size insert — while reads stay real random-access.
 */

import { createHash } from 'crypto';
import { Readable } from 'stream';
import {
  open,
  read as fsRead,
  close,
  createReadStream,
  promises as fsp,
} from 'fs';
import { basename, dirname, join } from 'path';
import { promisify } from 'util';

import {
  IndexEntry,
  TarIndex,
  scanTarFd,
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

const openAsync = promisify(open);
const closeAsync = promisify(close);
const readAsync = promisify(fsRead) as unknown as (
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number
) => Promise<{ bytesRead: number; buffer: Buffer }>;

/** Reject absolute paths, `..` traversal and back-slashes (§3 guard). */
function assertSafePath(path: string): void {
  if (path === '' || path.startsWith('/') || path.includes('\\') || /(^|\/)\.\.(\/|$)/.test(path)) {
    throw new Error(`Unsafe container path: ${path}`);
  }
}

export interface OpenOptions {
  /** Open writable so `flush` can atomically replace the file (default true). */
  writable?: boolean;
}

export class CryoContainer {
  readonly path: string;
  private fd: number;
  private index: TarIndex;
  private _manifest: ContainerManifest;
  private closed = false;

  /** Pending writes: value = Buffer to put, or null = remove. */
  private pending = new Map<string, Buffer | null>();

  private constructor(
    path: string,
    fd: number,
    index: TarIndex,
    manifest: ContainerManifest
  ) {
    this.path = path;
    this.fd = fd;
    this.index = index;
    this._manifest = manifest;
  }

  /** Open a container: one fd, one header scan, manifest read from entry #1. */
  static async open(path: string, _opts: OpenOptions = {}): Promise<CryoContainer> {
    const fd = await openAsync(path, 'r');
    try {
      const stat = await fsp.stat(path);
      const index = await scanTarFd(fd, stat.size);
      const manifestEntry = index.get(MANIFEST_PATH);
      let manifest: ContainerManifest;
      if (manifestEntry) {
        const buf = await readBody(fd, manifestEntry);
        manifest = parseManifest(buf.toString('utf-8'));
      } else {
        // Tolerate a container without a manifest: synthesize a minimal one.
        manifest = createManifest('');
      }
      return new CryoContainer(path, fd, index, manifest);
    } catch (err) {
      await closeAsync(fd).catch(() => undefined);
      throw err;
    }
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

  /** Read an entry body as a Buffer — seek+read, no unpacking. */
  async read(path: string): Promise<Buffer> {
    this.assertOpen();
    if (this.pending.has(path)) {
      const pend = this.pending.get(path);
      if (pend === null) throw new Error(`Entry removed: ${path}`);
      return Buffer.from(pend!);
    }
    const entry = this.index.get(path);
    if (!entry) throw new Error(`Entry not found: ${path}`);
    return readBody(this.fd, entry);
  }

  /** Read an entry body as UTF-8 text. */
  async readText(path: string): Promise<string> {
    return (await this.read(path)).toString('utf-8');
  }

  /**
   * Stream an entry body — for large assets, a positioned createReadStream over
   * the container fd's byte range (no intermediate buffer, no unpacking).
   */
  stream(path: string): Readable {
    this.assertOpen();
    if (this.pending.has(path)) {
      const pend = this.pending.get(path);
      if (pend === null) throw new Error(`Entry removed: ${path}`);
      return Readable.from(pend!);
    }
    const entry = this.index.get(path);
    if (!entry) throw new Error(`Entry not found: ${path}`);
    if (entry.size === 0) return Readable.from(Buffer.alloc(0));
    return createReadStream(this.path, {
      start: entry.offset,
      end: entry.offset + entry.size - 1,
    });
  }

  // -- Write path (buffered; committed by flush) ---------------------------

  /** Stage an entry write. Takes effect in the file only after `flush`. */
  async put(path: string, data: Buffer | string): Promise<void> {
    this.assertOpen();
    assertSafePath(path);
    this.pending.set(path, typeof data === 'string' ? Buffer.from(data, 'utf-8') : data);
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
   * Commit staged writes: rebuild the tar (manifest first, sha256 recomputed),
   * write it to a temp file, atomically rename over the original, then reopen
   * and rescan. Reads before/after remain real random-access.
   */
  async flush(): Promise<void> {
    this.assertOpen();
    if (this.pending.size === 0) return;

    // Materialize the full, ordered set of entries (excluding manifest, which
    // we regenerate and place first).
    const bodies = new Map<string, Buffer>();
    const order: string[] = [];
    for (const [path] of this.effectiveEntries()) {
      if (path === MANIFEST_PATH) continue;
      bodies.set(path, await this.read(path));
      order.push(path);
    }

    // Rebuild manifest contents with fresh sizes + sha256.
    const contents: ContentEntry[] = order.map((path) => {
      const body = bodies.get(path)!;
      return {
        path,
        type: inferContentType(path),
        size: body.length,
        sha256: sha256Hex(body),
      };
    });
    const manifest: ContainerManifest = {
      ...this._manifest,
      contents,
    };

    // manifest.json MUST be the first tar entry.
    const entries: Array<[string, Buffer | string]> = [
      [MANIFEST_PATH, serializeManifest(manifest)],
      ...order.map((p): [string, Buffer] => [p, bodies.get(p)!]),
    ];
    const tar = encodeTar(entries);

    // Atomic replace: temp + rename in the same directory.
    const tmp = join(dirname(this.path), `.${basename(this.path)}.tmp-${process.pid}`);
    await fsp.writeFile(tmp, tar);
    await closeAsync(this.fd);
    await fsp.rename(tmp, this.path);

    // Reopen + rescan so the handle reflects the committed file.
    this.fd = await openAsync(this.path, 'r');
    const stat = await fsp.stat(this.path);
    this.index = await scanTarFd(this.fd, stat.size);
    this._manifest = manifest;
    this.pending.clear();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await closeAsync(this.fd).catch(() => undefined);
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
        // Offset is meaningless for pending entries; size is what matters here.
        merged.set(path, { offset: -1, size: val.length, type: 'file' });
      }
    }
    return [...merged.entries()];
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('CryoContainer is closed');
  }
}

/** Open a container. Thin convenience wrapper over `CryoContainer.open`. */
export function openContainer(path: string, opts?: OpenOptions): Promise<CryoContainer> {
  return CryoContainer.open(path, opts);
}

// ============================================================================
// Helpers
// ============================================================================

async function readBody(fd: number, entry: IndexEntry): Promise<Buffer> {
  if (entry.size === 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(entry.size);
  await readAsync(fd, buf, 0, entry.size, entry.offset);
  return buf;
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
