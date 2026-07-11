/**
 * build-browser — bundle the isomorphic browser surface (src/browser.ts) into a
 * single self-contained ESM module the docs viewer imports. Run via
 * `npm run build:browser`. Fails loudly if any Node builtin leaks into the
 * bundle (fs/crypto/path/stream) — that would mean the core stopped being
 * isomorphic.
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'js', 'cryo-core.js');
const NODE_BUILTINS = ['fs', 'crypto', 'path', 'stream', 'util', 'os', 'child_process'];

esbuild
  .build({
    entryPoints: [path.join(ROOT, 'src', 'browser.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: OUT,
    // Never silently polyfill a Node builtin — surface it as a hard error.
    external: NODE_BUILTINS,
    logLevel: 'info',
  })
  .then(() => {
    const code = fs.readFileSync(OUT, 'utf-8');
    const leaked = NODE_BUILTINS.filter((m) =>
      new RegExp(`(from|require\\()\\s*["']${m}["']`).test(code)
    );
    if (leaked.length) {
      console.error(`\nERROR: Node builtins leaked into the browser bundle: ${leaked.join(', ')}`);
      console.error('The core is no longer isomorphic — find the offending import.');
      process.exit(1);
    }
    console.log(`\nbundled ${path.relative(ROOT, OUT)} (${(code.length / 1024).toFixed(1)} KB), no Node builtins.`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
