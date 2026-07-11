/**
 * publish-schema — mirror the canonical JSON Schema from src/container into
 * docs/schema so GitHub Pages serves it at
 * https://chevp.github.io/cryojs/schema/manifest.schema.json.
 * Run via `npm run schema:publish`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const from = path.join(ROOT, 'src', 'container', 'manifest.schema.json');
const to = path.join(ROOT, 'docs', 'schema', 'manifest.schema.json');

fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(from, to);
console.log('published', path.relative(ROOT, to));
