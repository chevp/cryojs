/**
 * fs-source — the Node `fs` backing for `RandomAccessSource`.
 *
 * This is the ONLY place in the container core that touches `fs`. It opens the
 * one file, keeps its descriptor, serves positioned reads, offers a zero-copy
 * byte-range stream, and commits `replaceAll` via a temp-file + atomic rename.
 * Everything else in the core is fs-free and runs unchanged in the browser.
 */

import {
  open as fsOpen,
  read as fsRead,
  close as fsClose,
  createReadStream,
  promises as fsp,
} from 'fs';
import { basename, dirname, join } from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';

import { WritableSource } from './source';

const openAsync = promisify(fsOpen);
const closeAsync = promisify(fsClose);
const readAsync = promisify(fsRead) as unknown as (
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number
) => Promise<{ bytesRead: number; buffer: Buffer }>;

export class FsSource implements WritableSource {
  readonly path: string;
  private fd: number;
  private _size: number;

  private constructor(path: string, fd: number, size: number) {
    this.path = path;
    this.fd = fd;
    this._size = size;
  }

  /** Open a file read-only and stat its size. */
  static async open(path: string): Promise<FsSource> {
    const fd = await openAsync(path, 'r');
    try {
      const stat = await fsp.stat(path);
      return new FsSource(path, fd, stat.size);
    } catch (err) {
      await closeAsync(fd).catch(() => undefined);
      throw err;
    }
  }

  get size(): number {
    return this._size;
  }

  async read(position: number, length: number): Promise<Uint8Array> {
    if (length === 0) return Buffer.alloc(0);
    const buf = Buffer.alloc(length);
    await readAsync(this.fd, buf, 0, length, position);
    return buf;
  }

  streamRange(start: number, endExclusive: number): Readable {
    if (endExclusive <= start) return Readable.from(Buffer.alloc(0));
    return createReadStream(this.path, { start, end: endExclusive - 1 });
  }

  /** Commit new bytes: write a temp file in the same dir, then atomic rename. */
  async replaceAll(bytes: Uint8Array): Promise<void> {
    const tmp = join(dirname(this.path), `.${basename(this.path)}.tmp-${process.pid}`);
    await fsp.writeFile(tmp, bytes);
    await closeAsync(this.fd);
    await fsp.rename(tmp, this.path);
    this.fd = await openAsync(this.path, 'r');
    const stat = await fsp.stat(this.path);
    this._size = stat.size;
  }

  async close(): Promise<void> {
    await closeAsync(this.fd).catch(() => undefined);
  }
}
