/**
 * cryojs - Node.js tooling library for Cryo Engine
 *
 * Provides parsing, validation, and compilation of .cryo files
 * to cryo-protocol messages.
 */

// Types
export * from './types';

// Parser
export { parse, ParseResult, ParseError, ParseWarning } from './parser';

// Compiler
export {
  compile,
  serialize,
  CompileResult,
  CompileError,
  AssetResolver,
  OutputFormat,
  SceneProto,
  EntityProto,
} from './compiler';

// Container (random-access .cryo tar container)
export * from './container';

// Convenience functions
import { readFileSync } from 'fs';
import { parse, ParseResult } from './parser';
import { compile, serialize, OutputFormat } from './compiler';
import { sniffFile } from './container/sniff';
import { openContainer, CryoContainer } from './container/reader';

/**
 * Parse a .cryo file from disk
 */
export function parseFile(filePath: string): ParseResult {
  const content = readFileSync(filePath, 'utf-8');
  return parse(content);
}

/**
 * Compile a .cryo file to protocol format
 */
export function compileFile(filePath: string, format: OutputFormat = 'json'): string {
  const parseResult = parseFile(filePath);

  if (parseResult.errors.length > 0) {
    throw new Error(`Parse errors: ${parseResult.errors.map((e) => e.message).join(', ')}`);
  }

  const compileResult = compile(parseResult.document);

  if (compileResult.errors.length > 0) {
    throw new Error(`Compile errors: ${compileResult.errors.map((e) => e.message).join(', ')}`);
  }

  return serialize(compileResult, format);
}

/**
 * Sniff-aware open: for a legacy XML `.cryo` return its parsed document; for a
 * tar container return an open `CryoContainer` handle. Backwards-compatible —
 * one extension, one icon (see docs/MIGRATION-cryo-container.md §4.3).
 */
export async function openCryo(
  filePath: string
): Promise<{ kind: 'xml'; result: ParseResult } | { kind: 'container'; container: CryoContainer }> {
  const kind = await sniffFile(filePath);
  if (kind === 'container') {
    return { kind: 'container', container: await openContainer(filePath) };
  }
  // 'xml' and 'unknown' both go down the legacy parse path.
  return { kind: 'xml', result: parseFile(filePath) };
}
