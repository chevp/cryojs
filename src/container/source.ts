/**
 * source — the positioned-byte-access abstraction the container reads through.
 *
 * The container core needs exactly one capability: "give me `length` bytes at
 * absolute `position`, without loading the whole file." `fs` is only *one*
 * backing for that. The same shape exists everywhere:
 *
 *   Node     fs.open + positioned read      → FsSource     (fs-source.ts)
 *   Browser  Blob.slice(start, end)         → (viewer)
 *   Memory   Uint8Array.subarray            → MemorySource  (here)
 *
 * Keeping the core over this interface is what makes it isomorphic: the exact
 * same reader/tar-scan runs in Node and the browser (see docs/js).
 */

import type { Readable } from 'stream';

/** Read-only positioned byte access over a container's bytes. */
export interface RandomAccessSource {
  /** Total byte length of the backing. */
  readonly size: number;
  /** Read `length` bytes starting at absolute `position`. */
  read(position: number, length: number): Promise<Uint8Array>;
  /** Release any held resource (fd, blob URL, …). */
  close(): Promise<void>;
  /**
   * Optional zero-copy byte-range stream (Node only). Callers must fall back to
   * `read()` when absent (the isomorphic path).
   */
  streamRange?(start: number, endExclusive: number): Readable;
}

/** A source that can atomically replace its whole backing (the write path). */
export interface WritableSource extends RandomAccessSource {
  /** Atomically replace the entire backing with `bytes`. */
  replaceAll(bytes: Uint8Array): Promise<void>;
}

/** Narrow a source to a writable one. */
export function isWritableSource(s: RandomAccessSource): s is WritableSource {
  return typeof (s as WritableSource).replaceAll === 'function';
}

/**
 * In-memory backing over a `Uint8Array` / `ArrayBuffer`. Isomorphic — the same
 * class the browser viewer uses after `File.arrayBuffer()`. Reads are plain
 * `subarray` slices (no copy); `replaceAll` swaps the buffer.
 */
export class MemorySource implements WritableSource {
  private buf: Uint8Array;

  constructor(bytes: Uint8Array | ArrayBuffer) {
    this.buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  get size(): number {
    return this.buf.byteLength;
  }

  /** Current backing bytes (live view, not a copy). */
  get bytes(): Uint8Array {
    return this.buf;
  }

  async read(position: number, length: number): Promise<Uint8Array> {
    return this.buf.subarray(position, position + length);
  }

  async replaceAll(bytes: Uint8Array): Promise<void> {
    this.buf = bytes;
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
