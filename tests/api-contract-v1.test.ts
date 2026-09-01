import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve('.');

describe('API V1 platform contract', () => {
  it('ships the machine-discoverable entrypoints', () => {
    for (const path of [
      'functions/api/v1/index.ts',
      'functions/api/v1/capabilities.ts',
      'functions/api/v1/registry/delta.ts',
      'functions/api/v1/registry/packages/[type]/[id]/versions.ts',
      'site/public/.well-known/dsh-marketplace.json',
      'schemas/dsh-marketplace-discovery.schema.json',
    ]) {
      expect(existsSync(resolve(root, path)), path).toBe(true);
    }
  });

  it('keeps the checked-in discovery document aligned with the API contract', () => {
    const discovery = JSON.parse(readFileSync(resolve(root, 'site/public/.well-known/dsh-marketplace.json'), 'utf8'));
    const schema = JSON.parse(readFileSync(resolve(root, 'schemas/dsh-marketplace-discovery.schema.json'), 'utf8'));
    expect(schema.properties.schema.const).toBe(discovery.schema);
    expect(discovery.api.version).toBe('v1');
    expect(discovery.registry.version).toBe(3);
    expect(discovery.package_types).toEqual(['plugin', 'mcp', 'skill', 'agent']);
    expect(discovery.installation.mode).toBe('plan-only');
  });
});
