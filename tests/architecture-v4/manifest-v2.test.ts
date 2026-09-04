import { describe, expect, it } from 'vitest';
import { PACKAGE_MANIFEST_FILE, PACKAGE_MANIFEST_SCHEMA_VERSION, validatePackageManifest } from '../../packages/protocol-core/manifest.mjs';

describe('Package Manifest V2', () => {
  it('uses one manifest file and explicit package identity', () => {
    expect(PACKAGE_MANIFEST_FILE).toBe('dsh-package.json');
    expect(PACKAGE_MANIFEST_SCHEMA_VERSION).toBe(2);
    const manifest = validatePackageManifest({
      schema_version: 2,
      type: 'skill',
      id: 'Owner/Example',
      version: '1.2.3',
      channel: 'stable',
      dependencies: [{ type: 'mcp', id: 'Owner/Server', range: '^2.0.0' }],
      permissions: ['network:https', 'network:https'],
      capabilities: ['skill'],
      entrypoints: { main: 'SKILL.md' },
      runtime: { executor: 'markdown' },
    });
    expect(manifest.id).toBe('owner/example');
    expect(manifest.dependencies).toEqual([{ type: 'mcp', id: 'owner/server', range: '^2.0.0', optional: false }]);
    expect(manifest.permissions).toEqual(['network:https']);
  });

  it('rejects old manifest schemas and implicit type', () => {
    expect(() => validatePackageManifest({ schema_version: 1, type: 'plugin', id: 'owner/pkg', version: '1.0.0' })).toThrow(/unsupported package manifest/i);
    expect(() => validatePackageManifest({ schema_version: 2, id: 'owner/pkg', version: '1.0.0' })).toThrow(/type/i);
  });
});
