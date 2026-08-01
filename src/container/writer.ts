/**
 * writer — build a `.cryo` container from a source folder (the `pack` path).
 *
 * Walks a directory, emits an uncompressed tar with `manifest.json` first,
 * autogenerates the manifest `contents` (size + sha256), and writes atomically.
 */

import { promises as fsp } from 'fs';
import { join, relative, sep } from 'path';

import { encodeTar } from './tar-index';
import { sha256Hex } from './sha256';
import {
  ContainerKind,
  ContainerManifest,
  ContentEntry,
  MANIFEST_PATH,
  createManifest,
  inferContentType,
  parseManifest,
  serializeManifest,
} from './manifest';

export interface PackOptions {
  /** Semantic category of the container (default: 'scene'). */
  kind?: ContainerKind;
  /** Primary scene entry path within the container. Auto-detected if omitted. */
  entry?: string;
  /** Container display name (default: folder basename). */
  name?: string;
}

/**
 * Extensions never allowed into a packed container — authoring-time scripts
 * (Blender/Python generators, Node build scripts), not runtime payload. See
 * ADR-0020: `tools/`-style generators are documented as non-runtime but were
 * still walked into the tar with nothing enforcing it.
 */
const DEFAULT_EXCLUDE_EXTENSIONS = ['.py', '.pyc', '.mjs', '.cjs'];

/** Optional per-container excludes, one pattern per line, `#`-comments allowed. */
const IGNORE_FILE = '.cryoignore';

async function readIgnorePatterns(srcDir: string): Promise<string[]> {
  try {
    const raw = await fsp.readFile(join(srcDir, IGNORE_FILE), 'utf-8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/** A pattern is an extension (`.py`), a directory prefix (`tools/`), or an exact path. */
function matchesPattern(path: string, pattern: string): boolean {
  if (pattern.startsWith('.') && !pattern.includes('/')) return path.endsWith(pattern);
  if (pattern.endsWith('/')) return path.startsWith(pattern);
  return path === pattern;
}

function isExcluded(path: string, ignorePatterns: string[]): boolean {
  return (
    DEFAULT_EXCLUDE_EXTENSIONS.some((ext) => path.endsWith(ext)) ||
    ignorePatterns.some((pattern) => matchesPattern(path, pattern))
  );
}

/** Recursively collect files under `dir` as container-relative forward paths. */
async function walk(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(abs, base)));
    } else if (e.isFile()) {
      out.push(relative(base, abs).split(sep).join('/'));
    }
  }
  return out;
}

/** Best-effort auto-detection of the primary scene entry. */
function detectEntry(paths: string[]): string {
  const scene =
    paths.find((p) => p === 'scenes/main.cryo.xml') ??
    paths.find((p) => p.startsWith('scenes/') && p.endsWith('.xml')) ??
    paths.find((p) => p.endsWith('.cryo.xml')) ??
    paths.find((p) => p.endsWith('.xml'));
  return scene ?? '';
}

/**
 * Pack a source folder into a container written at `outPath`.
 * If the folder already carries a `manifest.json`, its `entry`/`name` are kept
 * unless overridden; `contents` is always regenerated.
 */
export async function packFolder(
  srcDir: string,
  outPath: string,
  opts: PackOptions = {}
): Promise<ContainerManifest> {
  const ignorePatterns = await readIgnorePatterns(srcDir);
  const walked = (await walk(srcDir, srcDir)).filter((p) => p !== MANIFEST_PATH && p !== IGNORE_FILE);
  const excluded = walked.filter((p) => isExcluded(p, ignorePatterns)).sort();
  if (excluded.length) {
    console.warn(`[cryojs] pack: excluded ${excluded.length} authoring-only file(s): ${excluded.join(', ')}`);
  }
  const allPaths = walked.filter((p) => !isExcluded(p, ignorePatterns)).sort();

  // Read bodies once.
  const bodies = new Map<string, Buffer>();
  for (const p of allPaths) {
    bodies.set(p, await fsp.readFile(join(srcDir, p)));
  }

  // Seed manifest from an existing one if present.
  const fallbackName = opts.name ?? basename(srcDir);
  let manifest: ContainerManifest;
  try {
    const existing = await fsp.readFile(join(srcDir, MANIFEST_PATH), 'utf-8');
    manifest = parseManifest(existing);
  } catch {
    manifest = createManifest(opts.kind ?? 'scene', fallbackName);
  }

  const kind = opts.kind ?? manifest.kind ?? 'scene';
  const entry = opts.entry ?? (manifest.entry || detectEntry(allPaths));
  const name = opts.name ?? manifest.name ?? basename(srcDir);

  const contents: ContentEntry[] = allPaths.map((path) => {
    const body = bodies.get(path)!;
    return { path, type: inferContentType(path), size: body.length, sha256: sha256Hex(body) };
  });

  manifest = { ...manifest, kind, name, contents };
  if (entry) manifest.entry = entry;

  const entries: Array<[string, Buffer | string]> = [
    [MANIFEST_PATH, serializeManifest(manifest)],
    ...allPaths.map((p): [string, Buffer] => [p, bodies.get(p)!]),
  ];
  const tar = encodeTar(entries);

  const tmp = `${outPath}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, tar);
  await fsp.rename(tmp, outPath);

  return manifest;
}

/** Basename without importing path's `basename` (keep forward-slash aware). */
function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
