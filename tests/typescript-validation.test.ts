import { describe, it, expect } from 'vitest';
import { validateTypeScript } from '../src/mcp/tools/validation.js';

describe('TypeScript Validation', () => {
  it('should accept valid TypeScript code', () => {
    const validCode = 'async () => { return 42; }';
    const result = validateTypeScript(validCode, '');

    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('should reject code with type mismatches', () => {
    const invalidCode = 'async () => { const x: number = "string"; return x; }';
    const result = validateTypeScript(invalidCode, '');

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors).toContain('Type');
    expect(result.errors).toContain('string');
  });

  it('should reject code with syntax errors', () => {
    const syntaxError = 'async () => { const x = ; }';
    const result = validateTypeScript(syntaxError, '');

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it('should reject code that references undefined variables', () => {
    const invalidCode = 'async () => { return nonExistentVariable; }';
    const result = validateTypeScript(invalidCode, '');

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors).toContain('Cannot find name');
  });

  it('should reject code that calls undefined functions', () => {
    const invalidCode = 'async () => { return nonExistentFunction(); }';
    const result = validateTypeScript(invalidCode, '');

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors).toContain('Cannot find name');
  });

  it('should provide detailed error messages with line and column numbers', () => {
    const invalidCode = 'async () => { const x: number = "not a number"; return x; }';
    const result = validateTypeScript(invalidCode, '');

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    // Should include line/column info
    expect(result.errors).toMatch(/Line \d+, Column \d+:/);
  });
});
