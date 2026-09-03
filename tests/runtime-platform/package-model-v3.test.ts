import { describe, expect, it } from 'vitest';

const {
  inferPackageType,
  normalizePackageDependency,
  packageKey,
  parsePackageSpec,
} = await import('../../runtime/package-model.mjs');

describe('Runtime Platform V3 unified package model', () => {
  it('parses typed specs while preserving plugin compatibility', () => {
    expect(parsePackageSpec('demo@1.2.3')).toEqual({ type: 'plugin', id: 'demo', version: '1.2.3' });
    expect(parsePackageSpec('mcp:owner/server@2.0.0')).toEqual({ type: 'mcp', id: 'owner/server', version: '2.0.0' });
    expect(parsePackageSpec('github:owner/plugin', '0.1.0')).toEqual({ type: 'plugin', id: 'owner/plugin', version: '0.1.0' });
    expect(packageKey('skill', 'Demo')).toBe('skill:demo');
  });

  it('infers ecosystem types and supports typed dependencies', () => {
    expect(inferPackageType({ runtime: { type: 'agent' } })).toBe('agent');
    expect(inferPackageType({ capabilities: ['mcp'] })).toBe('mcp');
    expect(inferPackageType({ capabilities: [] })).toBe('plugin');
    expect(normalizePackageDependency('skill:helper@^1.0.0')).toEqual({
      type: 'skill', id: 'helper', range: '^1.0.0', optional: false,
    });
  });

  it('rejects unsupported types and unsafe ids', () => {
    expect(() => parsePackageSpec('tool:demo@1.0.0')).toThrow(/unsafe|version/);
    expect(() => parsePackageSpec('mcp:../../evil@1.0.0')).toThrow(/unsafe/);
    expect(() => parsePackageSpec('mcp:owner/../evil@1.0.0')).toThrow(/unsafe/);
    expect(() => packageKey('plugin', '..')).toThrow(/unsafe/);
  });
});
