import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { artifactIntegrity } from '../scripts/checksum.mjs';
import { resolvePackage } from '../runtime/resolver.mjs';
import { explainResolution } from '../runtime/solver-v2.mjs';
import { resolveAcrossRegistries, writeRegistries } from '../runtime/registry-manager.mjs';
import { exportDshPackage, installDshPackage, readDshPackage } from '../runtime/dshpkg.mjs';
import { readRuntimeRegistry, writeRuntimeRegistry } from '../runtime/registry.mjs';

function record(id: string, version: string, options: any = {}) {
  const commit = options.commit || version.replaceAll('.', '').padEnd(40, 'a').slice(0, 40);
  const source = { provider: 'github', repo: options.repo || `owner/${id}`, ref: 'main', commit };
  return {
    id,
    version,
    channel: options.channel || 'stable',
    source,
    artifact: { kind: 'git-source', integrity: artifactIntegrity({ version, source }) },
    runtime: { type: options.type || 'plugin' },
    capabilities: options.capabilities || [],
    dependencies: options.dependencies || [],
    permissions: options.permissions || [],
    publisher: options.publisher || { id: 'owner' },
    security: options.security || {},
    metadata: {},
  };
}
function registry(records: any[]) {
  return { registry_version: 3, schema_version: '3.0.0', defaults: { plugin_version: '0.1.0' }, plugins: records };
}

describe('Package Manager Core V2', () => {
  it('skips yanked releases and fails closed for revoked/security-blocked releases', () => {
    const safe = record('demo', '1.0.0');
    const yanked = record('demo', '1.1.0', { security: { yanked: true } });
    expect(resolvePackage(registry([safe, yanked]), 'plugin', 'demo', '*').version).toBe('1.0.0');
    expect(() => resolvePackage(registry([record('revoked', '1.0.0', { security: { revoked: true } })]), 'plugin', 'revoked', '*')).toThrow(/revoked/i);
    expect(() => resolvePackage(registry([record('unsafe', '1.0.0', { security: { advisories: [{ id: 'ADV-1', severity: 'critical', affected: '*' }] } })]), 'plugin', 'unsafe', '*')).toThrow(/advisory/i);
  });

  it('explains version selection and dependency graph', () => {
    const dep = record('dep', '2.1.0');
    const root = record('root', '1.2.0', { dependencies: [{ id: 'dep', type: 'plugin', range: '^2.0.0' }] });
    const old = record('root', '1.0.0');
    const result = explainResolution(registry([old, root, dep]), { type: 'plugin', id: 'root', version: '^1.0.0', channel: 'stable' });
    expect(result.selected.version).toBe('1.2.0');
    expect(result.dependency_order.map((item: any) => item.key)).toEqual(['plugin:dep', 'plugin:root']);
    expect(result.graph.root[0]).toMatchObject({ id: 'dep', version: '2.1.0' });
  });

  it('fails closed when registries publish the same package under different publisher identities', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-multi-registry-'));
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    const config = join(dir, 'registries.json');
    await writeFile(a, JSON.stringify(registry([record('same', '1.0.0', { publisher: { id: 'publisher-a' } })])));
    await writeFile(b, JSON.stringify(registry([record('same', '1.0.0', { publisher: { id: 'publisher-b' } })])));
    await writeRegistries({ registries: [
      { name: 'a', url: a, priority: 100, trusted: true },
      { name: 'b', url: b, priority: 90, trusted: true },
    ] }, config);
    await expect(resolveAcrossRegistries('same', { type: 'plugin', version: '*', file: config })).rejects.toMatchObject({ code: 'DSH_REGISTRY_IDENTITY_CONFLICT' });
  });

  it('exports and reinstalls a verified offline .dshpkg into pending-restart state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-dshpkg-'));
    const sourceRoot = join(dir, 'source-package');
    const runtimeFile = join(dir, 'runtime.json');
    const packageHome = join(dir, 'packages');
    const output = join(dir, 'demo.dshpkg');
    await mkdir(sourceRoot, { recursive: true });
    const source = { provider: 'github', repo: 'owner/demo', ref: 'main', commit: 'a'.repeat(40) };
    const lock = {
      registry_version: 3, runtime_registry_version: 3, id: 'demo', type: 'plugin', package_type: 'plugin', version: '1.0.0', channel: 'stable', source,
      artifact: { kind: 'git-source', integrity: artifactIntegrity({ version: '1.0.0', source }) }, runtime: { type: 'plugin' }, capabilities: [], dependencies: [], permissions: [], compatibility: {}, publisher: { id: 'owner' }, security: {}, conflicts: [], replaces: [], provides: [], type_config: null,
    };
    await writeFile(join(sourceRoot, '.dsh-install.json'), JSON.stringify(lock));
    await writeFile(join(sourceRoot, 'index.js'), 'export default 1;\n');
    await writeRuntimeRegistry({ schema_version: 3, generation: 0, packages: [{ type: 'plugin', id: 'demo', version: '1.0.0', state: 'active', enabled: true, activated: true, restart_required: false, path: sourceRoot, source, commit: source.commit }] }, runtimeFile);

    const exported = await exportDshPackage('plugin:demo', output, { registryFile: runtimeFile });
    expect(exported.digest).toMatch(/^[0-9a-f]{64}$/);
    expect((await readDshPackage(output)).bundle.package.id).toBe('demo');

    await writeRuntimeRegistry({ schema_version: 3, generation: 1, packages: [] }, runtimeFile, { force: true });
    const installed = await installDshPackage(output, { registryFile: runtimeFile, root: packageHome, approved: true });
    expect(installed.executed).toBe(true);
    const runtime = await readRuntimeRegistry(runtimeFile);
    expect(runtime.packages[0]).toMatchObject({ id: 'demo', state: 'pending-restart', restart_required: true });
    expect(await readFile(join(runtime.packages[0].path, 'index.js'), 'utf8')).toContain('export default 1');
  });
});
