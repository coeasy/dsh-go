import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizePackagePlanDocument, withNormalizedPackagePlan } from '../runtime/plan-normalizer.mjs';
import { executePackageTransaction } from '../runtime/transaction.mjs';

describe('profile and bundle PackageRequest normalization', () => {
  it('normalizes versionless string and object entries to latest-compatible ranges', () => {
    expect(normalizePackagePlanDocument({ packages: [
      'plugin:demo',
      { id: 'server', type: 'mcp', channel: 'beta' },
      { id: 'skill-x', type: 'skill', version: '^1.2.0' },
    ] })).toEqual({ packages: [
      'plugin:demo@*',
      { id: 'server', type: 'mcp', version: '*', channel: 'beta' },
      { id: 'skill-x', type: 'skill', version: '^1.2.0', channel: 'stable' },
    ] });
  });

  it('lets the existing Transaction Engine resolve a versionless plan to the latest stable release', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-plan-normalization-'));
    const planFile = join(dir, 'profile.json');
    const registryFile = join(dir, 'registry-v3.json');
    const runtimeFile = join(dir, 'runtime.json');
    await writeFile(planFile, JSON.stringify({ name: 'latest-profile', packages: ['plugin:demo'] }, null, 2));
    const packageRecord = (version: string, commit: string) => ({
      id: 'demo',
      version,
      channel: 'stable',
      source: { provider: 'github', repo: 'owner/demo', ref: 'main', commit },
      artifact: { kind: 'git-source', integrity: `sha256:${version}` },
      runtime: { type: 'plugin' },
      capabilities: [],
      dependencies: [],
      permissions: [],
      metadata: {},
    });
    await writeFile(registryFile, JSON.stringify({
      registry_version: 3,
      schema_version: '3.0.0',
      defaults: { plugin_version: '0.1.0' },
      plugins: [
        packageRecord('0.1.0', '1111111111111111111111111111111111111111'),
        packageRecord('0.2.0', '2222222222222222222222222222222222222222'),
      ],
    }, null, 2));
    await writeFile(runtimeFile, JSON.stringify({ schema_version: 3, generation: 0, packages: [] }, null, 2));

    const result = await withNormalizedPackagePlan(planFile, (normalizedFile) => executePackageTransaction(normalizedFile, {
      kind: 'profile',
      catalog: registryFile,
      registryFile: runtimeFile,
      dryRun: true,
      approved: true,
    }));
    expect(result.file).toBe(planFile);
    expect(result.dry_run).toBe(true);
    expect(result.order).toEqual([
      expect.objectContaining({ type: 'plugin', id: 'demo', version: '0.2.0', commit: '2222222222222222222222222222222222222222' }),
    ]);

    const original = JSON.parse(await readFile(planFile, 'utf8'));
    expect(original.packages).toEqual(['plugin:demo']);
  });
});
