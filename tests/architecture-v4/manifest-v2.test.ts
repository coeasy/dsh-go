import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validatePackageManifest } from '../../packages/protocol-core/manifest.mjs';
import { normalizeDshManifest } from '../../runtime/package-manifest.mjs';

const canonicalManifest = {
  manifest_version: 2,
  type: 'skill',
  id: 'owner/example',
  version: '1.2.3',
  channel: 'stable',
  name: 'Example Skill',
  description: 'Canonical Manifest V2 fixture',
  runtime: { type: 'skill', executor: 'markdown' },
  entrypoints: { main: 'SKILL.md' },
  capabilities: ['skill'],
  permissions: ['network'],
  dependencies: [{ type: 'mcp', id: 'owner/helper', range: '^2.0.0', channel: 'stable' }],
  compatibility: { os: ['linux', 'darwin', 'win32'] },
  publisher: { id: 'owner', provider: 'github' },
  security: { provenance: { uri: 'provenance.json', digest: `sha256:${'a'.repeat(64)}` } },
  metadata: { category: 'skills' },
  source: { provider: 'github', repo: 'owner/example' },
};

describe('Manifest V2 canonical contract', () => {
  it('uses numeric manifest_version=2, canonical owner/name identity, and preserves authority fields', () => {
    const manifest = validatePackageManifest(canonicalManifest);
    expect(manifest.manifest_version).toBe(2);
    expect(manifest.id).toBe('owner/example');
    expect(manifest.publisher).toEqual({ id: 'owner', provider: 'github' });
    expect(manifest.security).toEqual(canonicalManifest.security);
    expect(manifest.source).toEqual({ provider: 'github', repo: 'owner/example' });
    expect(manifest.dependencies[0]).toMatchObject({ type: 'mcp', id: 'owner/helper', range: '^2.0.0', channel: 'stable' });
  });

  it('rejects legacy schema_version and incomplete compatibility-shaped manifests', () => {
    expect(() => normalizeDshManifest({ ...canonicalManifest, manifest_version: undefined, schema_version: 2 })).toThrow(/schema_version/);
    expect(() => validatePackageManifest({ ...canonicalManifest, publisher: undefined })).toThrow(/publisher is required/);
    expect(() => validatePackageManifest({ ...canonicalManifest, dependencies: [{ type: 'mcp', id: 'owner/helper', range: '^2.0.0' }] })).toThrow(/dependency.channel is required/);
  });

  it('keeps the checked-in JSON Schema and package manifests on the exact same contract', async () => {
    const schema = JSON.parse(await readFile('schemas/dsh-package-v2.schema.json', 'utf8'));
    expect(schema.properties.manifest_version.const).toBe(2);
    expect(schema.properties).not.toHaveProperty('schema_version');
    expect(schema.properties.id.pattern).toContain('/');

    for (const path of [
      'dsh-package.json',
      'packages/dsh-go-marketplace/dsh-package.json',
      'packages/dsh-go-marketplace-plugin/dsh-package.json',
    ]) {
      const raw = JSON.parse(await readFile(path, 'utf8'));
      expect(validatePackageManifest(raw).manifest_version).toBe(2);
      expect(raw).not.toHaveProperty('schema_version');
    }
  });
});
