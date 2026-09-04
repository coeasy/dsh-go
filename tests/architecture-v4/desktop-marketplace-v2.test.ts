import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePackageManifest } from '../../packages/protocol-core/manifest.mjs';

describe('desktop Marketplace V2 boundary', () => {
  it('uses Manifest V2 and canonical Protocol/API versions', async () => {
    const raw = JSON.parse(await readFile(resolve('packages/dsh-go-marketplace-plugin/dsh-package.json'), 'utf8'));
    const manifest = validatePackageManifest(raw);
    expect(manifest.manifest_version).toBe(2);
    expect(raw).not.toHaveProperty('schema_version');
    expect(manifest.type).toBe('plugin');
    expect(manifest.id).toBe('coeasy/dsh-go-marketplace-plugin');
    expect(manifest.publisher.id).toBe('coeasy');
    expect(manifest.source).toMatchObject({ provider: 'github', repo: 'coeasy/dsh-go' });
    expect(manifest.metadata?.local_host_api).toBe('v2');
    expect(manifest.metadata?.remote_api).toBe('v2');
    expect(manifest.metadata?.auto_restart).toBe(false);
  });

  it('calls only Local Host V2 mutation surfaces and remote API V2 discovery', async () => {
    const source = await readFile(resolve('packages/dsh-go-marketplace-plugin/index.mjs'), 'utf8');
    expect(source).toContain('/v2/install/plan');
    expect(source).toContain('/v2/install/execute');
    expect(source).toContain('/v2/packages/action');
    expect(source).toContain('/v2/runtime/activate');
    expect(source).toContain('/api/v2/search');
    expect(source).not.toContain('/v1/');
    expect(source).not.toContain('/api/v1');
    expect(source).not.toContain('registry/add');
    expect(source).not.toContain('host/restart');
  });

  it('does not ship an independent installer or Runtime State implementation', async () => {
    const source = await readFile(resolve('packages/dsh-go-marketplace-plugin/index.mjs'), 'utf8');
    for (const forbidden of ['runtime/installer', 'runtime/registry', 'runtime/transaction', 'packages/resolver', 'writeRuntimeRegistry']) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('Runtime Supervisor');
    expect(source).toContain('auto_restart: false');
  });
});
