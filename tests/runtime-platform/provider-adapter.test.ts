import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertProviderAdapter,
  providerAdapterDigest,
} from '../../runtime/provider-adapter.mjs';
import {
  createEmptyProviderAdapterRegistry,
  registerProviderAdapter,
  resolveProviderAdapter,
  rollbackProviderAdapterChannel,
} from '../../runtime/provider-adapter-registry.mjs';
import {
  installProviderAdapterRelease,
  providerAdapterStatus,
  rollbackInstalledProviderAdapter,
} from '../../runtime/provider-store.mjs';
import { buildProviderAdapterPackage } from '../../scripts/provider-adapter-pack.mjs';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(version = '0.1.0', body = 'export default {};\n') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-provider-adapter-'));
  roots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.mjs'), body, 'utf8');
  const manifest = {
    manifest_version: '1.0.0',
    id: 'demo-provider',
    name: 'Demo Provider',
    description: 'Test provider adapter',
    version,
    kind: 'llm',
    entrypoint: 'src/index.mjs',
    files: ['src'],
    capabilities: ['chat'],
    release: { channel: 'stable' },
  };
  await writeFile(join(root, 'provider-adapter.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { root, manifest, manifestFile: join(root, 'provider-adapter.json') };
}

describe('Provider Adapter Release V1', () => {
  it('requires an explicit file contract and hashes canonical manifests deterministically', () => {
    const a = {
      manifest_version: '1.0.0', id: 'demo', name: 'Demo', version: '0.1.0', kind: 'llm',
      entrypoint: 'index.mjs', files: ['index.mjs'], capabilities: ['models', 'chat'],
    };
    const b = {
      capabilities: ['chat', 'models'], files: ['index.mjs'], entrypoint: 'index.mjs', kind: 'llm',
      version: '0.1.0', name: 'Demo', id: 'demo', manifest_version: '1.0.0',
    };
    expect(providerAdapterDigest(a)).toBe(providerAdapterDigest(b));
    expect(() => assertProviderAdapter({ ...a, files: [] })).toThrow(/explicit non-empty array/);
    expect(() => assertProviderAdapter({ ...a, entrypoint: '../escape.mjs' })).toThrow(/unsafe provider adapter path/);
  });

  it('produces byte-for-byte identical archives, release descriptors and SBOMs', async () => {
    const { manifestFile } = await fixture();
    const source = { repository: 'coeasy/demo-provider', commit: 'a'.repeat(40), tag: 'v0.1.0' };
    const first = await buildProviderAdapterPackage(manifestFile, source);
    const second = await buildProviderAdapterPackage(manifestFile, source);
    expect(Buffer.compare(first.archive, second.archive)).toBe(0);
    expect(first.release).toEqual(second.release);
    expect(first.sbom).toEqual(second.sbom);
    expect(first.release.artifact.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(first.release.release_id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps id@version immutable, makes retries idempotent, and rolls channel pointers back without deleting releases', async () => {
    const v1 = await fixture('0.1.0', 'export default { version: 1 };\n');
    const v2 = await fixture('0.2.0', 'export default { version: 2 };\n');
    const v1Changed = await fixture('0.1.0', 'export default { version: "mutated" };\n');
    const r1 = (await buildProviderAdapterPackage(v1.manifestFile)).release;
    const r2 = (await buildProviderAdapterPackage(v2.manifestFile)).release;
    const mutated = (await buildProviderAdapterPackage(v1Changed.manifestFile)).release;

    let registry = createEmptyProviderAdapterRegistry();
    const first = registerProviderAdapter(registry, r1);
    registry = first.registry;
    expect(first.changed).toBe(true);
    expect(registerProviderAdapter(registry, r1).changed).toBe(false);
    expect(() => registerProviderAdapter(registry, mutated)).toThrow(/immutable/);

    registry = registerProviderAdapter(registry, r2).registry;
    expect(resolveProviderAdapter(registry, 'demo-provider', 'stable').version).toBe('0.2.0');
    const rollback = rollbackProviderAdapterChannel(registry, 'demo-provider', 'stable');
    expect(rollback.to).toBe('0.1.0');
    expect(resolveProviderAdapter(rollback.registry, 'demo-provider', 'stable').version).toBe('0.1.0');
    expect(rollback.registry.providers[0].versions.map((release) => release.version)).toEqual(['0.1.0', '0.2.0']);
  });

  it('installs verified archives atomically and supports local active-version rollback', async () => {
    const v1 = await fixture('0.1.0', 'export default { version: 1 };\n');
    const v2 = await fixture('0.2.0', 'export default { version: 2 };\n');
    const p1 = await buildProviderAdapterPackage(v1.manifestFile);
    const p2 = await buildProviderAdapterPackage(v2.manifestFile);
    const home = join(v1.root, 'provider-home');

    await installProviderAdapterRelease(p1.release, { archiveBuffer: p1.archive, home, channel: 'stable' });
    await installProviderAdapterRelease(p2.release, { archiveBuffer: p2.archive, home, channel: 'stable' });
    expect((await providerAdapterStatus('demo-provider', { home })).active_version).toBe('0.2.0');
    const rolledBack = await rollbackInstalledProviderAdapter('demo-provider', null, { home });
    expect(rolledBack).toMatchObject({ from: '0.2.0', to: '0.1.0', changed: true });
    const status = await providerAdapterStatus('demo-provider', { home });
    expect(status.active_version).toBe('0.1.0');
    expect(status.healthy).toBe(true);
    expect(JSON.parse(await readFile(join(home, 'versions', 'demo-provider', '0.1.0', '.dsh-provider-install.json'), 'utf8')).release_id).toBe(p1.release.release_id);
  });
});
