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

// Convenience functions
import { readFileSync } from 'fs';
import { parse, ParseResult } from './parser';
import { compile, serialize, OutputFormat } from './compiler';

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
