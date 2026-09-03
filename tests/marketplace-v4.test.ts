import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveEdgePackageRequest } from '../functions/_package-request';
import { packageDetailV2, trustFor } from '../functions/_marketplace-v4';
import { normalizeManifestV2, validateManifestV2 } from '../runtime/manifest-v2.mjs';
import { buildSearchIndexV3 } from '../scripts/build-search-index-v3.mjs';
import { buildPublisherSubmission } from '../runtime/publisher-workflow.mjs';

function pkg(version = '1.0.0', options: any = {}) {
  return {
    id: options.id || 'demo',
    version,
    channel: options.channel || 'stable',
    source: { provider: 'github', repo: options.repo || 'owner/demo', ref: 'main', commit: options.commit || 'a'.repeat(40) },
    artifact: { kind: 'git-source', integrity: 'sha256-fixture' },
    runtime: { type: options.type || 'plugin' },
    capabilities: ['plugin'],
    permissions: [],
    dependencies: [],
    publisher: options.publisher || { provider: 'github', id: 'owner', repository_ownership: 'verified' },
    security: options.security || {},
    metadata: { name: 'Demo', description: 'Original description', stars: options.stars ?? 1000, verified: options.verified ?? false },
  } as any;
}

describe('Marketplace Platform V4', () => {
  it('keeps trust independent from popularity and localization independent from identity', () => {
    const item = pkg('1.0.0', { stars: 100000, publisher: { provider: 'github', id: 'owner', repository_ownership: 'unverified' } });
    const trust = trustFor(item);
    expect(trust.score).toBeLessThan(55);
    const overlay = { schema_version: 1, locale: 'zh-CN', entries: { 'plugin:demo': { name: '演示包', description: '本地化描述' } } } as any;
    const detail = packageDetailV2(item, overlay);
    expect(detail.identity).toMatchObject({ key: 'plugin:demo', id: 'demo', version: '1.0.0', repo: 'owner/demo', commit: 'a'.repeat(40) });
    expect(detail.presentation).toMatchObject({ name: '演示包', description: '本地化描述' });
    expect(detail.popularity).toBe(100000);
    expect(detail.trust.score).toBe(trust.score);
  });

  it('aligns edge install planning with local security policy semantics', () => {
    const safe = pkg('1.0.0');
    const yanked = pkg('1.1.0', { security: { yanked: true } });
    const critical = pkg('1.2.0', { security: { advisories: [{ id: 'ADV-1', severity: 'critical', affected: '*' }] } });
    expect(resolveEdgePackageRequest([safe, yanked, critical], { id: 'demo', type: 'plugin', version: '*' }).package.version).toBe('1.0.0');
    expect(() => resolveEdgePackageRequest([critical], { id: 'demo', type: 'plugin', version: '*' })).toThrow(/security policy/i);
    expect(() => resolveEdgePackageRequest([pkg('0.9.0', { security: { minimum_safe_version: '1.0.0' } })], { id: 'demo', type: 'plugin', version: '*' })).toThrow(/security policy/i);
    expect(() => resolveEdgePackageRequest([pkg('1.0.0', { security: { revoked: true } })], { id: 'demo', type: 'plugin', version: '*' })).toThrow(/security policy/i);
  });

  it('builds localized search v3 without turning translation fields into package identity', () => {
    const registry = { registry_version: 3, schema_version: '3.0.0', generated: { at: '2026-09-03T00:00:00.000Z', content_hash: 'registry-hash' }, plugins: [pkg()] } as any;
    const overlay = { schema_version: 1, locale: 'es', entries: { 'plugin:demo': { name: 'Paquete Demo', description: 'Descripción localizada' } } };
    const index = buildSearchIndexV3(registry, { locale: 'es', overlay });
    expect(index).toMatchObject({ version: 3, locale: 'es', registry_hash: 'registry-hash', count: 1 });
    expect(index.items[0]).toMatchObject({ key: 'plugin:demo', id: 'demo', repo: 'owner/demo', commit: 'a'.repeat(40), name: 'Paquete Demo' });
    expect(index.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes v1 manifests into v2 while enforcing verified GitHub ownership', () => {
    const base = {
      manifest_version: '1.0.0', id: 'demo', name: 'Demo', version: '0.1.0', type: 'plugin', source: { provider: 'github', repo: 'owner/demo', commit: 'a'.repeat(40) },
      publisher: { provider: 'github', id: 'owner', repository_ownership: 'verified' }, permissions: [], capabilities: ['plugin'], security: { license: 'MIT', provenance: {}, signature: {}, sbom: {} },
    };
    const normalized = normalizeManifestV2(base)!;
    expect(normalized).toMatchObject({ manifest_version: '2.0.0', id: 'demo', source: { repo: 'owner/demo' }, publisher: { id: 'owner', repository_ownership: 'verified' }, localization: { default_locale: 'en', overlay_key: 'plugin:demo' } });
    expect(validateManifestV2(base).valid).toBe(true);
    expect(validateManifestV2({ ...base, publisher: { provider: 'github', id: 'other', repository_ownership: 'verified' } }).valid).toBe(false);
  });

  it('generates a non-mutating publisher submission plan with SBOM and immutable identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-publisher-v4-'));
    const manifest = {
      manifest_version: '2.0.0', id: 'demo', name: 'Demo', version: '0.1.0', type: 'plugin', source: { provider: 'github', repo: 'owner/demo', commit: 'a'.repeat(40) },
      publisher: { provider: 'github', id: 'owner', repository_ownership: 'verified' }, permissions: [], capabilities: ['plugin'], dependencies: [],
      compatibility: { os: ['linux', 'darwin', 'win32'] }, security: { license: 'MIT', provenance: { uri: 'prov.json' }, signature: { uri: 'sig.json' }, sbom: { uri: 'sbom.json' } }, plugin: { entrypoint: 'index.mjs' },
    };
    await writeFile(join(root, 'dsh-package.json'), JSON.stringify(manifest));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo', version: '0.1.0', type: 'module' }));
    await writeFile(join(root, 'index.mjs'), 'export default {};\n');
    const result = await buildPublisherSubmission(root);
    expect(result).toMatchObject({ publishable: true, mutation: false, registry_submission: 'pull-request-or-approved-publisher-workflow' });
    expect(result.package).toMatchObject({ key: 'plugin:demo', version: '0.1.0' });
    expect(JSON.parse(await readFile(result.files.submission, 'utf8')).mutation).toBe(false);
  });
});
