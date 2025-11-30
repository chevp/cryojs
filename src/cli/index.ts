#!/usr/bin/env node

/**
 * cryojs CLI - Command-line interface for .cryo file operations
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename, extname } from 'path';
import chalk from 'chalk';
import { glob } from 'glob';

import { parse } from '../parser';
import { compile, serialize, OutputFormat } from '../compiler';

const program = new Command();

program
  .name('cryojs')
  .description('Cryo Engine tooling - .cryo file parser and compiler')
  .version('1.0.0');

// ============================================================================
// Parse Command
// ============================================================================

program
  .command('parse <file>')
  .description('Parse a .cryo file and output the AST')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('--pretty', 'Pretty print JSON output', true)
  .action((file: string, options: { output?: string; pretty?: boolean }) => {
    try {
      const filePath = resolve(file);

      if (!existsSync(filePath)) {
        console.error(chalk.red(`Error: File not found: ${filePath}`));
        process.exit(1);
      }

      const content = readFileSync(filePath, 'utf-8');
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
  .action((file: string, options: { output?: string; format?: string }) => {
    try {
      const filePath = resolve(file);

      if (!existsSync(filePath)) {
        console.error(chalk.red(`Error: File not found: ${filePath}`));
        process.exit(1);
      }

      const content = readFileSync(filePath, 'utf-8');
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
  .action((file: string) => {
    try {
      const filePath = resolve(file);

      if (!existsSync(filePath)) {
        console.error(chalk.red(`Error: File not found: ${filePath}`));
        process.exit(1);
      }

      const content = readFileSync(filePath, 'utf-8');
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

// Parse command line arguments
program.parse();
