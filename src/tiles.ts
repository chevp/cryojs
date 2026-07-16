/**
 * Cryo container tiles — the canonical visual identity of a container `kind`.
 *
 * A `.cryo`'s `manifest.kind` is the semantic discriminator (see ContainerKind /
 * KNOWN_KINDS). This module couples each kind to the three things that fully
 * determine how its tile looks, so every consumer — the kosmos container, the
 * CLI, iris web tooling — renders an identical tile from ONE source of truth:
 *
 *   - symbol : `icon`   (a Font Awesome 6 class; the whole kosmos surface uses FA6)
 *   - colour : `colors` (two gradient stops) → {@link tileGradient} builds the CSS
 *   - shape  : {@link SQUIRCLE_MASK} (the iOS/macOS squircle, as a CSS mask value)
 *
 * The snowflake is the general/default tile for an unknown or unspecified kind.
 * This module is pure and isomorphic (no fs / DOM), so it is exported from both
 * the Node ('@cryo/cryojs') and browser ('@cryo/cryojs/browser') entry points.
 *
 * Consumers may extend the built-in set at runtime with {@link registerTile}
 * (e.g. an iris-only kind) without diverging from the shared look.
 */

/**
 * How a kind groups in a palette. `content` = kosmos scene/authoring kinds
 * (incl. the four schema container kinds); `general` = domain-neutral container
 * categories a `.cryo` can carry outside kosmos (vault, archive, dataset, …).
 */
export type TileGroup = 'content' | 'general';

/** One kind's tile identity: its symbol and its colour (the two are coupled). */
export interface CryoTileSpec {
  /** The `manifest.kind` value, or `'default'` for the general snowflake tile. */
  kind: string;
  /** Human-readable label. */
  label: string;
  /** Font Awesome 6 class — the symbol of this kind. */
  icon: string;
  /** The two gradient stops (hex) — the colour of this kind. */
  colors: readonly [string, string];
  /** Palette group; defaults to `content` when omitted. */
  group?: TileGroup;
}

/** Gradient angle every tile badge uses, so the colour ramp is identical. */
export const TILE_GRADIENT_ANGLE = '135deg';

/**
 * The squircle badge shape as a ready-to-use CSS `mask` value (an inline SVG
 * superellipse). Apply to a badge element (with a gradient background):
 *   `element.style.mask = element.style.webkitMask = SQUIRCLE_MASK;`
 * A referenced <clipPath> (`url(#id)`) renders unreliably in some engines and
 * falls back to a round blob — a self-contained mask cuts the exact squircle
 * everywhere and still shows the gradient.
 */
export const SQUIRCLE_MASK =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath fill='%23000' d='M50 0C78 0 100 22 100 50C100 78 78 100 50 100C22 100 0 78 0 50C0 22 22 0 50 0Z'/%3E%3C/svg%3E") center / 100% 100% no-repeat`;

/** Build the CSS `linear-gradient(...)` for a tile's badge background. */
export function tileGradient(spec: CryoTileSpec, angle: string = TILE_GRADIENT_ANGLE): string {
  return `linear-gradient(${angle}, ${spec.colors[0]}, ${spec.colors[1]})`;
}

/** The general/default tile: the snowflake, for an unknown/unspecified kind. */
export const DEFAULT_TILE: CryoTileSpec = {
  kind: 'default',
  label: 'General',
  icon: 'fa-solid fa-snowflake',
  colors: ['#78aadc', '#5b8ec4'],
};

// Built-in tiles. Colours are Tailwind 500→600 stops, mirroring the colour↔symbol
// coupling on https://chevp.github.io. The first four are cryojs's known
// container kinds (KNOWN_KINDS); the rest are the broader content / general
// categories the open `kind` field is meant to carry.
export const BUILTIN_TILES: readonly CryoTileSpec[] = [
  // ── Known cryo container kinds (schema.ts KNOWN_KINDS) ──
  { kind: 'scene',      label: 'Scene',      icon: 'fa-solid fa-cube',           colors: ['#3b82f6', '#2563eb'] }, // blue
  { kind: 'material',   label: 'Material',   icon: 'fa-solid fa-palette',        colors: ['#06b6d4', '#0891b2'] }, // cyan
  { kind: 'shader',     label: 'Shader',     icon: 'fa-solid fa-bolt',           colors: ['#a855f7', '#9333ea'] }, // purple
  { kind: 'asset-pack', label: 'Asset Pack', icon: 'fa-solid fa-box-archive',    colors: ['#22c55e', '#16a34a'] }, // green
  // ── Content kinds ──
  { kind: 'script',     label: 'Script',     icon: 'fa-solid fa-scroll',         colors: ['#f97316', '#ea580c'] }, // orange
  { kind: 'prefab',     label: 'Prefab',     icon: 'fa-solid fa-puzzle-piece',   colors: ['#ec4899', '#db2777'] }, // pink
  { kind: 'world',      label: 'World',      icon: 'fa-solid fa-earth-americas', colors: ['#14b8a6', '#0d9488'] }, // teal
  { kind: 'audio',      label: 'Audio',      icon: 'fa-solid fa-music',          colors: ['#6366f1', '#4f46e5'] }, // indigo
  { kind: 'texture',    label: 'Texture',    icon: 'fa-solid fa-image',          colors: ['#f59e0b', '#d97706'] }, // amber
  { kind: 'animation',  label: 'Animation',  icon: 'fa-solid fa-film',           colors: ['#ef4444', '#dc2626'] }, // red
  { kind: 'ui',         label: 'UI',         icon: 'fa-solid fa-table-columns',  colors: ['#84cc16', '#65a30d'] }, // lime
  // ── General (non-kosmos) container categories ──
  { kind: 'vault',      label: 'Vault',      icon: 'fa-solid fa-vault',          colors: ['#64748b', '#475569'], group: 'general' }, // slate
  { kind: 'snapshot',   label: 'Snapshot',   icon: 'fa-solid fa-camera-retro',   colors: ['#0ea5e9', '#0284c7'], group: 'general' }, // sky
  { kind: 'archive',    label: 'Archive',    icon: 'fa-solid fa-file-zipper',    colors: ['#78716c', '#57534e'], group: 'general' }, // stone
  { kind: 'dataset',    label: 'Dataset',    icon: 'fa-solid fa-database',       colors: ['#10b981', '#059669'], group: 'general' }, // emerald
  { kind: 'document',   label: 'Document',   icon: 'fa-solid fa-file-lines',     colors: ['#71717a', '#52525b'], group: 'general' }, // zinc
  { kind: 'model',      label: 'Model',      icon: 'fa-solid fa-brain',          colors: ['#8b5cf6', '#7c3aed'], group: 'general' }, // violet
  { kind: 'plugin',     label: 'Plugin',     icon: 'fa-solid fa-plug',           colors: ['#f43f5e', '#e11d48'], group: 'general' }, // rose
  { kind: 'template',   label: 'Template',   icon: 'fa-solid fa-clone',          colors: ['#eab308', '#ca8a04'], group: 'general' }, // yellow
];

/** Built-in tiles in the `content` group (kosmos scene/authoring kinds). */
export const CONTENT_TILES: readonly CryoTileSpec[] = BUILTIN_TILES.filter(
  (t) => (t.group ?? 'content') === 'content',
);

/** Built-in tiles in the `general` group (domain-neutral container categories). */
export const GENERAL_TILES: readonly CryoTileSpec[] = BUILTIN_TILES.filter(
  (t) => t.group === 'general',
);

// Registry, seeded with the built-ins. Keyed by kind; register overrides.
const REGISTRY = new Map<string, CryoTileSpec>();
for (const t of BUILTIN_TILES) REGISTRY.set(t.kind, t);

/** Register (or override) a kind's tile — for domain kinds beyond the built-ins. */
export function registerTile(spec: CryoTileSpec): void {
  REGISTRY.set(spec.kind, spec);
}

/** Every registered tile (built-ins plus any registered), in insertion order. */
export function allTiles(): CryoTileSpec[] {
  return [...REGISTRY.values()];
}

/** Resolve a `manifest.kind` to its tile, falling back to the default snowflake. */
export function tileForKind(kind?: string | null): CryoTileSpec {
  if (!kind) return DEFAULT_TILE;
  return REGISTRY.get(kind) ?? DEFAULT_TILE;
}
