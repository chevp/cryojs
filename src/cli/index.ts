#!/usr/bin/env node

/**
 * cryojs CLI - Command-line interface for .cryo file operations
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename, extname, dirname } from 'path';
import chalk from 'chalk';
import { glob } from 'glob';

import { parse } from '../parser';
import { compile, serialize, OutputFormat } from '../compiler';
import { openContainer, packFolder, sniffFile, sha256Hex } from '../container';

const program = new Command();

program
  .name('cryojs')
  .description('Cryo Engine tooling - .cryo file parser and container')
  .version('2.0.0');

/**
 * Resolve a `.cryo` input to XML text: for a legacy XML file, its content; for
 * a tar container, its manifest scene entry read via the random-access API.
 * Used by parse/compile/info so they transparently accept both forms (§4.4).
 */
async function resolveCryoXml(filePath: string): Promise<string> {
  const kind = await sniffFile(filePath);
  if (kind === 'container') {
    const c = await openContainer(filePath);
    try {
      const entry = c.manifest.entry;
      if (!entry) throw new Error('Container manifest has no scene entry');
      return await c.readText(entry);
    } finally {
      await c.close();
    }
  }
  return readFileSync(filePath, 'utf-8');
}

// ============================================================================
// Parse Command
// ============================================================================

program
  .command('parse <file>')
  .description('Parse a .cryo file and output the AST')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('--pretty', 'Pretty print JSON output', true)
  .action(async (file: string, options: { output?: string; pretty?: boolean }) => {
    try {
      const filePath = resolve(file);

      if (!existsSync(filePath)) {
        console.error(chalk.red(`Error: File not found: ${filePath}`));
        process.exit(1);
      }

      const content = await resolveCryoXml(filePath);
      const result = parse(content);

      // Report errors and warnings
      for (const warning of result.warnings) {
        console.error(chalk.yellow(`Warning: ${warning.message}`));
      }

      for (const error of result.errors) {
        console.error(chalk.red(`Error: ${error.message}`));
      }

      if (result.errors.length > 0) {
        process.exit(1);
      }

      const output = options.pretty
        ? JSON.stringify(result.document, null, 2)
        : JSON.stringify(result.document);

      if (options.output) {
        writeFileSync(options.output, output);
        console.log(chalk.green(`Parsed to: ${options.output}`));
      } else {
        console.log(output);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err}`));
      process.exit(1);
    }
  });

// ============================================================================
// Compile Command
// ============================================================================

program
  .command('compile <file>')
  .description('Compile a .cryo file to protocol buffer format')
  .option('-o, --output <file>', 'Output file')
  .option('-f, --format <format>', 'Output format: json, pbtxt', 'json')
  .action(async (file: string, options: { output?: string; format?: string }) => {
    try {
      const filePath = resolve(file);

      if (!existsSync(filePath)) {
        console.error(chalk.red(`Error: File not found: ${filePath}`));
        process.exit(1);
      }

      const content = await resolveCryoXml(filePath);
      const parseResult = parse(content);

      // Report parse errors
      for (const error of parseResult.errors) {
        console.error(chalk.red(`Parse error: ${error.message}`));
      }

      if (parseResult.errors.length > 0) {
        process.exit(1);
      }

      const compileResult = compile(parseResult.document);

      // Report compile errors
      for (const error of compileResult.errors) {
        console.error(chalk.red(`Compile error: ${error.message}`));
      }

      if (compileResult.errors.length > 0) {
        process.exit(1);
      }

      const format = (options.format || 'json') as OutputFormat;
      const output = serialize(compileResult, format);

      if (options.output) {
        writeFileSync(options.output, output);
        console.log(chalk.green(`Compiled to: ${options.output}`));
      } else {
        console.log(output);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err}`));
      process.exit(1);
    }
  });

// ============================================================================
// Validate Command
// ============================================================================

program
  .command('validate <pattern>')
  .description('Validate .cryo files matching a glob pattern')
  .option('--strict', 'Treat warnings as errors')
  .action(async (pattern: string, options: { strict?: boolean }) => {
    try {
      const files = await glob(pattern);

      if (files.length === 0) {
        console.log(chalk.yellow(`No files found matching: ${pattern}`));
        process.exit(0);
      }

      let hasErrors = false;
      let totalWarnings = 0;

      for (const file of files) {
        const content = readFileSync(file, 'utf-8');
        const result = parse(content);

        const hasFileErrors = result.errors.length > 0;
        const hasFileWarnings = result.warnings.length > 0;

        if (hasFileErrors || hasFileWarnings) {
          console.log(chalk.bold(`\n${file}:`));
        }

        for (const warning of result.warnings) {
          console.log(chalk.yellow(`  Warning: ${warning.message}`));
          totalWarnings++;
        }

        for (const error of result.errors) {
          console.log(chalk.red(`  Error: ${error.message}`));
        }

        if (hasFileErrors) {
          hasErrors = true;
        }

        if (options.strict && hasFileWarnings) {
          hasErrors = true;
        }
      }

      console.log('');
      console.log(chalk.bold(`Validated ${files.length} file(s)`));

      if (hasErrors) {
        console.log(chalk.red('Validation failed'));
        process.exit(1);
      } else {
        console.log(chalk.green('All files valid'));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err}`));
      process.exit(1);
    }
  });

// ============================================================================
// Watch Command
// ============================================================================

program
  .command('watch <pattern>')
  .description('Watch .cryo files and compile on change')
  .option('-o, --outdir <dir>', 'Output directory')
  .option('-f, --format <format>', 'Output format: json, pbtxt', 'json')
  .action(async (pattern: string, options: { outdir?: string; format?: string }) => {
    console.log(chalk.blue(`Watching for changes: ${pattern}`));
    console.log(chalk.gray('Press Ctrl+C to stop'));

    const { watch } = await import('fs');

    const compileFile = (file: string) => {
      try {
        const content = readFileSync(file, 'utf-8');
        const parseResult = parse(content);

        if (parseResult.errors.length > 0) {
          for (const error of parseResult.errors) {
            console.error(chalk.red(`  ${error.message}`));
          }
          return;
        }

        const compileResult = compile(parseResult.document);

        if (compileResult.errors.length > 0) {
          for (const error of compileResult.errors) {
            console.error(chalk.red(`  ${error.message}`));
          }
          return;
        }

        const format = (options.format || 'json') as OutputFormat;
        const output = serialize(compileResult, format);

        if (options.outdir) {
          const ext = format === 'pbtxt' ? '.pbtxt' : '.json';
          const outFile = resolve(options.outdir, basename(file, extname(file)) + ext);
          writeFileSync(outFile, output);
          console.log(chalk.green(`  -> ${outFile}`));
        } else {
          console.log(output);
        }
      } catch (err) {
        console.error(chalk.red(`  Error: ${err}`));
      }
    };

    const files = await glob(pattern);

    for (const file of files) {
      watch(file, (event) => {
        if (event === 'change') {
          console.log(chalk.blue(`\nChanged: ${file}`));
          compileFile(file);
        }
      });
    }

    // Initial compile
    for (const file of files) {
      console.log(chalk.blue(`Compiling: ${file}`));
      compileFile(file);
    }
  });

// ============================================================================
// Info Command
// ============================================================================

program
  .command('info <file>')
  .description('Show information about a .cryo file')
  .action(async (file: string) => {
    try {
      const filePath = resolve(file);

      if (!existsSync(filePath)) {
        console.error(chalk.red(`Error: File not found: ${filePath}`));
        process.exit(1);
      }

      const content = await resolveCryoXml(filePath);
      const result = parse(content);

      if (result.errors.length > 0) {
        console.error(chalk.red('Parse errors:'));
        for (const error of result.errors) {
          console.error(chalk.red(`  ${error.message}`));
        }
        process.exit(1);
      }

      const doc = result.document;

      console.log(chalk.bold('\nFile Information:'));
      console.log(`  Version: ${doc.version}`);

      if (doc.meta) {
        console.log(chalk.bold('\nMetadata:'));
        if (doc.meta.name) console.log(`  Name: ${doc.meta.name}`);
        if (doc.meta.description) console.log(`  Description: ${doc.meta.description}`);
        if (doc.meta.author) console.log(`  Author: ${doc.meta.author}`);
        if (doc.meta.tags) console.log(`  Tags: ${doc.meta.tags.join(', ')}`);
      }

      if (doc.imports) {
        console.log(chalk.bold('\nImports:'));
        console.log(`  Files: ${doc.imports.imports.length}`);
        console.log(`  Assets: ${doc.imports.assets.length}`);
        console.log(`  Lua Modules: ${doc.imports.luaModules.length}`);
      }

      if (doc.scene) {
        console.log(chalk.bold('\nScene:'));
        console.log(`  ID: ${doc.scene.id}`);
        console.log(`  Name: ${doc.scene.name || '(unnamed)'}`);
        console.log(`  Entities: ${countEntities(doc.scene.entities)}`);

        const componentCounts = countComponents(doc.scene.entities);
        if (Object.keys(componentCounts).length > 0) {
          console.log(chalk.bold('\nComponents:'));
          for (const [type, count] of Object.entries(componentCounts)) {
            console.log(`  ${type}: ${count}`);
          }
        }
      }

      if (doc.prefab) {
        console.log(chalk.bold('\nPrefab:'));
        console.log(`  ID: ${doc.prefab.id}`);
        console.log(`  Name: ${doc.prefab.name || '(unnamed)'}`);
        console.log(`  Components: ${doc.prefab.components.length}`);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err}`));
      process.exit(1);
    }
  });

function countEntities(entities: Array<{ children: unknown[] }>): number {
  let count = entities.length;
  for (const entity of entities) {
    count += countEntities(entity.children as Array<{ children: unknown[] }>);
  }
  return count;
}

function countComponents(entities: Array<{ components: Array<{ type: string }>; children: unknown[] }>): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const entity of entities) {
    for (const component of entity.components) {
      counts[component.type] = (counts[component.type] || 0) + 1;
    }
    const childCounts = countComponents(entity.children as Array<{ components: Array<{ type: string }>; children: unknown[] }>);
    for (const [type, count] of Object.entries(childCounts)) {
      counts[type] = (counts[type] || 0) + count;
    }
  }

  return counts;
}

// ============================================================================
// Container Commands (.cryo tar container — random-access API)
// ============================================================================

program
  .command('pack <dir>')
  .description('Pack a folder into a .cryo container (autoindex + sha256)')
  .option('-o, --output <file>', 'Output container path (default: <dir>.cryo)')
  .option('-e, --entry <path>', 'Primary scene entry inside the container')
  .option('-n, --name <name>', 'Container display name')
  .action(async (dir: string, options: { output?: string; entry?: string; name?: string }) => {
    try {
      const srcDir = resolve(dir);
      if (!existsSync(srcDir)) {
        console.error(chalk.red(`Error: Folder not found: ${srcDir}`));
        process.exit(1);
      }
      const out = options.output
        ? resolve(options.output)
        : resolve(basename(srcDir) + '.cryo');
      const manifest = await packFolder(srcDir, out, { entry: options.entry, name: options.name });
      console.log(chalk.green(`Packed ${manifest.contents.length} entrie(s) -> ${out}`));
      console.log(chalk.gray(`  entry: ${manifest.entry || '(none)'}`));
    } catch (err) {
      console.error(chalk.red(`Error: ${err}`));
      process.exit(1);
    }
  });

program
  .command('ls <file>')
  .description('List entries in a .cryo container (uses the offset index)')
  .option('-l, --long', 'Show size and sha256')
  .action(async (file: string, options: { long?: boolean }) => {
    try {
      const filePath = resolve(file);
      if ((await sniffFile(filePath)) !== 'container') {
        console.error(chalk.yellow('Not a container (.cryo tar). Legacy XML .cryo has no entries.'));
        process.exit(1);
      }
      const c = await openContainer(filePath);
      try {
        for (const e of c.list()) {
          if (options.long) {
            const sha = e.sha256 ? e.sha256.slice(0, 12) : '-'.repeat(12);
            console.log(`${String(e.size).padStart(9)}  ${sha}  ${e.path}`);
          } else {
            console.log(e.path);
          }
        }
      } finally {
        await c.close();
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err}`));
      process.exit(1);
    }
  });

program
  .command('cat <file> <entry>')
  .description('Print one container entry (random-access seek+read)')
  .action(async (file: string, entry: string) => {
    try {
      const filePath = resolve(file);
      const c = await openContainer(filePath);
      try {
        process.stdout.write(await c.read(entry));
      } finally {
        await c.close();
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err}`));
      process.exit(1);
    }
  });

program
  .command('inspect <file>')
  .description('Show container manifest + contents (no scan of entry bodies)')
  .action(async (file: string) => {
    try {
      const filePath = resolve(file);
      const c = await openContainer(filePath);
      try {
        const m = c.manifest;
        console.log(chalk.bold('\nContainer:'));
        console.log(`  Format:  ${m.format}`);
        console.log(`  Version: ${m.version}`);
        console.log(`  Name:    ${m.name || '(unnamed)'}`);
        console.log(`  Entry:   ${m.entry || '(none)'}`);
        console.log(chalk.bold('\nContents:'));
        for (const e of c.list()) {
          console.log(`  ${chalk.cyan(e.type.padEnd(8))} ${String(e.size).padStart(9)}  ${e.path}`);
        }
        console.log('');
      } finally {
        await c.close();
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err}`));
      process.exit(1);
    }
  });

program
  .command('verify <file>')
  .description('Verify entry sha256 against the container manifest')
  .action(async (file: string) => {
    try {
      const filePath = resolve(file);
      const c = await openContainer(filePath);
      try {
        let checked = 0;
        let failed = 0;
        for (const e of c.manifest.contents) {
          if (!e.sha256) continue;
          checked++;
          const actual = sha256Hex(await c.read(e.path));
          if (actual !== e.sha256) {
            failed++;
            console.log(chalk.red(`  MISMATCH ${e.path}`));
            console.log(chalk.gray(`    expected ${e.sha256}`));
            console.log(chalk.gray(`    actual   ${actual}`));
          }
        }
        if (checked === 0) {
          console.log(chalk.yellow('No sha256 hashes in manifest to verify.'));
        } else if (failed === 0) {
          console.log(chalk.green(`OK — ${checked} entrie(s) verified.`));
        } else {
          console.log(chalk.red(`FAILED — ${failed}/${checked} entrie(s) mismatched.`));
          process.exit(1);
        }
      } finally {
        await c.close();
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err}`));
      process.exit(1);
    }
  });

program
  .command('unpack <file>')
  .description('Extract a container to a folder (escape hatch — NOT the normal path)')
  .option('-o, --outdir <dir>', 'Output directory', './out')
  .action(async (file: string, options: { outdir?: string }) => {
    try {
      const filePath = resolve(file);
      const outDir = resolve(options.outdir || './out');
      const c = await openContainer(filePath);
      try {
        const { mkdirSync, writeFileSync: writeFile } = await import('fs');
        for (const e of c.list()) {
          const dest = resolve(outDir, e.path);
          mkdirSync(dirname(dest), { recursive: true });
          writeFile(dest, await c.read(e.path));
        }
        console.log(chalk.green(`Unpacked ${c.list().length} entrie(s) -> ${outDir}`));
      } finally {
        await c.close();
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err}`));
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();
