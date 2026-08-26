import { describe, expect, it } from 'vitest';
import { preflightPackage } from '../../runtime/preflight.mjs';

function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    version: '0.1.0',
    channel: 'stable',
    source: { repo: `owner/${id}`, ref: 'main', commit: 'a'.repeat(40), archive_url: `https://github.com/owner/${id}/archive/${'a'.repeat(40)}.tar.gz` },
    artifact: { integrity: `sha256-${'b'.repeat(64)}` },
    runtime: { type: 'plugin', activation: 'restart-required' },
    capabilities: ['plugin'],
    dependencies: [],
    metadata: {},
    ...extra,
  };
}

describe('dependency-wide install preflight', () => {
  it('aggregates dangerous permissions from transitive dependencies before install', () => {
    const registry = {
      registry_version: 3,
      defaults: { plugin_version: '0.1.0' },
      plugins: [
        item('dangerous-dependency', { permissions: ['shell'] }),
        item('root-package', { dependencies: [{ id: 'dangerous-dependency', range: '*' }] }),
      ],
    };
    const report = preflightPackage(registry, 'root-package@0.1.0', { type: 'plugin', installed: [] });
    expect(report.allowed).toBe(true);
    expect(report.permissions.requires_consent).toBe(true);
    expect(report.permissions.dangerous).toContain('shell');
    expect(report.dependency_plan?.order.map((entry: { id: string }) => entry.id)).toEqual(['dangerous-dependency', 'root-package']);
    expect(report.package_checks.find((entry: { id: string }) => entry.id === 'dangerous-dependency')?.permissions.dangerous).toContain('shell');
  });
});
