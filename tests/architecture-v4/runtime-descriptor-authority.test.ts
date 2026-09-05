import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRegistryV4, validateRegistryV4 } from '../../packages/registry-core/index.mjs';
import { resolvePackage } from '../../packages/resolver/index.mjs';
import { writeRegistryDistributionV2 } from '../../scripts/registry-distribution-v2.mjs';

const COMMIT = 'a'.repeat(40);

function sourceRecord(overrides: Record<string, unknown> = {}) {
  return {
    type: 'plugin',
    id: 'example/runtime-aware',
    version: '1.2.3',
    channel: 'stable',
    published_at: '2026-09-05T00:00:00.000Z',
    source: { provider: 'github', repo: 'example/runtime-aware', commit: COMMIT },
    publisher: { id: 'example', name: 'Example' },
    artifact: {
      kind: 'release-archive',
      url: 'https://github.com/example/runtime-aware/releases/download/v1.2.3/runtime-aware-1.2.3.tgz',
      digest: `sha256-${'b'.repeat(64)}`,
      format: 'tgz',
      strip_components: 1,
    },
    runtime: {
      type: 'plugin',
      host: 'tauri-or-compatible-webview',
      activation: 'explicit',
      sandbox: { mode: 'isolated', network: false },
    },
    entrypoints: { main: 'index.mjs', ui: 'ui/index.html' },
    capabilities: ['runtime.status'],
    permissions: ['network'],
    compatibility: { os: ['linux', 'darwin', 'win32'] },
    security: {},
    dependencies: [],
    metadata: { name: 'Runtime aware package' },
    ...overrides,
  };
}

describe('Registry V4 runtime descriptor authority', () => {
  it('preserves the complete runtime descriptor through Registry, Resolver and Distribution V2', async () => {
    const expectedRuntime = sourceRecord().runtime;
    const registry = buildRegistryV4([sourceRecord()], {
      generated_at: '2026-09-05T00:00:00.000Z',
      source: 'runtime-descriptor-test',
    });

    expect(registry.packages[0].releases[0].runtime).toEqual(expectedRuntime);

    const plan = resolvePackage(registry, {
      type: 'plugin',
      id: 'example/runtime-aware',
      range: '1.2.3',
      channel: 'stable',
    }, { os: 'linux' });
    expect(plan.root.runtime).toEqual(expectedRuntime);

    const output = await mkdtemp(join(tmpdir(), 'dsh-registry-distribution-'));
    await writeRegistryDistributionV2(registry, output);
    const index = JSON.parse(await readFile(join(output, 'index.json'), 'utf8'));
    const shard = JSON.parse(await readFile(join(output, index.packages['plugin:example/runtime-aware'].path), 'utf8'));
    expect(shard.releases[0].runtime).toEqual(expectedRuntime);
  });

  it('fails closed when an installable Registry V4 release loses its runtime descriptor', () => {
    expect(() => buildRegistryV4([sourceRecord({ runtime: undefined })])).toThrow(/runtime descriptor is required/);
  });

  it('rejects a runtime descriptor whose package type diverges from the Registry package type', () => {
    expect(() => buildRegistryV4([sourceRecord({ runtime: { type: 'mcp', transport: 'streamable-http' } })]))
      .toThrow(/runtime\.type must match package type plugin/);
  });

  it('revalidates runtime descriptors when consuming an external Registry V4 payload', () => {
    const registry = buildRegistryV4([sourceRecord()]);
    registry.packages[0].releases[0].runtime = { type: 'agent' };
    expect(() => validateRegistryV4(registry)).toThrow(/runtime\.type must match package type plugin/);
  });

  it('uses Registry Core types as the Edge API V2 type authority', async () => {
    const source = await readFile(new URL('../../functions/_registry-v4.ts', import.meta.url), 'utf8');
    expect(source).toContain("from '../packages/registry-core/index.mjs'");
    expect(source).toContain('export type RegistryV4Release = CanonicalRegistryV4Release');
    expect(source).not.toContain('export interface RegistryV4Release');
  });
});
