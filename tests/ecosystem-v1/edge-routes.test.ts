import { describe, expect, it } from 'vitest';
import { onRequestGet as getInstallPlan } from '../../functions/api/v1/install-plan';
import { onRequestGet as getPackageDetail } from '../../functions/api/v1/package-detail';
import { onRequestGet as getProvider } from '../../functions/api/v1/providers/[id]';

const commit = 'a'.repeat(40);

function packageRecord(version: string, options: { channel?: string; type?: 'plugin' | 'mcp'; repo?: string } = {}) {
  const type = options.type || 'plugin';
  return {
    id: 'demo',
    version,
    channel: options.channel || 'stable',
    source: { provider: 'github', repo: options.repo || 'owner/demo', ref: 'main', commit },
    artifact: { kind: 'git-source', integrity: `sha256-${'b'.repeat(64)}` },
    runtime: { type, activation: 'restart-required' },
    capabilities: ['plugin', type],
    dependencies: [],
    permissions: [],
    metadata: { name: 'Demo', description: 'demo package', verified: false },
  };
}

function registryEnv(records: unknown[]) {
  return {
    ASSETS: {
      fetch: async (input: Request | string | URL) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
        if (url.pathname === '/catalog/registry-v3.json') {
          return new Response(JSON.stringify({
            registry_version: 3,
            schema_version: '3.0.0',
            generated: { at: '2026-09-03T00:00:00.000Z', content_hash: 'registry-test' },
            plugins: records,
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('not found', { status: 404 });
      },
    },
  } as any;
}

describe('edge package route contracts', () => {
  it('honors an install-plan version range instead of silently resolving latest', async () => {
    const response = await getInstallPlan({
      request: new Request('https://example.test/api/v1/install-plan?id=demo&type=plugin&version=1.0.0'),
      env: registryEnv([packageRecord('1.0.0'), packageRecord('2.0.0')]),
    } as any) as Response;
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.request.version_range).toBe('1.0.0');
    expect(body.resolved.version).toBe('1.0.0');
  });

  it('supports repository aliases and semver ordering in package details', async () => {
    const response = await getPackageDetail({
      request: new Request('https://example.test/api/v1/package-detail?id=owner%2Fdemo&type=plugin'),
      env: registryEnv([packageRecord('1.0.0'), packageRecord('1.0.0-beta.1'), packageRecord('2.0.0')]),
    } as any) as Response;
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.package.key).toBe('plugin:demo');
    expect(body.releases.map((item: any) => item.identity.version)).toEqual(['2.0.0', '1.0.0', '1.0.0-beta.1']);
  });

  it('does not expose a provider release through an unsupported channel fallback', async () => {
    const providerRegistry = {
      registry_version: 1,
      schema_version: '1.0.0',
      generated: { at: '2026-09-03T00:00:00.000Z', count: 1, release_count: 1, content_hash: 'provider-test' },
      providers: [{
        id: 'demo-provider', name: 'Demo Provider', kind: 'llm', channels: { beta: '1.0.0-beta.1' },
        versions: [{ id: 'demo-provider', name: 'Demo Provider', version: '1.0.0-beta.1', kind: 'llm', release_id: 'release-1', artifact: { integrity: `sha256-${'c'.repeat(64)}`, size: 1, file_name: 'demo.tgz' } }],
      }],
    };
    const env = {
      ASSETS: {
        fetch: async () => new Response(JSON.stringify(providerRegistry), { status: 200, headers: { 'content-type': 'application/json' } }),
      },
    } as any;
    const response = await getProvider({
      request: new Request('https://example.test/api/v1/providers/demo-provider'),
      env,
      params: { id: 'demo-provider' },
    } as any) as Response;
    expect(response.status).toBe(404);
  });
});
