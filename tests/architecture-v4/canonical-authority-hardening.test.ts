import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { evaluateCompatibility } from '../../runtime/compatibility.mjs';
import { inspectPackageAdvisories } from '../../runtime/advisory.mjs';
import {
  inspectPermissions as inspectPolicyPermissions,
  normalizePermissions as normalizePolicyPermissions,
} from '../../packages/policy-core/permissions.mjs';
import {
  inspectPermissions as inspectRuntimePermissions,
  normalizePermissions as normalizeRuntimePermissions,
} from '../../runtime/permissions.mjs';

describe('canonical architecture authorities', () => {
  it('uses Protocol V2 SemVer for runtime compatibility', () => {
    const compatible = evaluateCompatibility(
      { compatibility: { runtime: '^0.1.0', node: '>=22.0.0 <23.0.0' } },
      { os: 'linux', arch: 'x64', node: '22.10.0', runtime: '0.1.3', client: '0.1.0', capabilities: [] },
    );
    expect(compatible.compatible).toBe(true);

    const incompatible = evaluateCompatibility(
      { compatibility: { runtime: '^0.2.0' } },
      { os: 'linux', arch: 'x64', node: '22.10.0', runtime: '0.1.3', client: '0.1.0', capabilities: [] },
    );
    expect(incompatible.compatible).toBe(false);
  });

  it('inspects advisories from Registry V4 packages/releases only', () => {
    const registry = {
      schema_version: 4,
      packages: [{
        type: 'plugin',
        id: 'owner/pkg',
        releases: [
          { version: '1.2.0', channel: 'stable', security: { advisories: [{ id: 'A', severity: 'critical', affected: '^1.0.0' }] } },
          { version: '2.0.0', channel: 'stable', security: { advisories: [] } },
        ],
      }],
    };
    const result = inspectPackageAdvisories(registry, { type: 'plugin', id: 'owner/pkg', range: '^1.0.0', channel: 'stable' });
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0].security.critical).toBe(1);
  });

  it('keeps permission semantics in Policy Core with Runtime as a facade', () => {
    const sample = ['filesystem.read', 'shell', 'unknown.permission', 'shell'];
    expect(normalizeRuntimePermissions(sample)).toEqual(normalizePolicyPermissions(sample));
    expect(inspectRuntimePermissions(sample)).toEqual(inspectPolicyPermissions(sample));
    expect(inspectPolicyPermissions(sample).requires_consent).toBe(true);
  });

  it('contains no legacy runtime semver/package-model imports in canonical compatibility/security modules', async () => {
    for (const file of ['runtime/compatibility.mjs', 'runtime/advisory.mjs']) {
      const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
      expect(source).not.toContain("'./semver.mjs'");
      expect(source).not.toContain("'./package-model.mjs'");
      expect(source).toContain('packages/protocol-core');
    }
  });
});
