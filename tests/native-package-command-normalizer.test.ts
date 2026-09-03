import { describe, expect, it } from 'vitest';
import { normalizeDshInstallUri, normalizeInstallVersionArgs } from '../runtime/command-normalizer.mjs';
import { isPackageManagerV2Command } from '../runtime/package-manager-v2-cli.mjs';

describe('native package install normalization', () => {
  it('turns versionless typed installs into latest-compatible requests', () => {
    expect(normalizeInstallVersionArgs(['plugin', 'install', 'memory-kit']))
      .toEqual(['plugin', 'install', 'memory-kit@*']);
    expect(normalizeInstallVersionArgs(['mcp', 'install', 'coeasy/dsh-go-marketplace']))
      .toEqual(['mcp', 'install', 'coeasy/dsh-go-marketplace@*']);
  });

  it('normalizes generic package installs without changing package type', () => {
    expect(normalizeInstallVersionArgs(['package', 'install', 'skill:example/tool']))
      .toEqual(['package', 'install', 'skill:example/tool@*']);
  });

  it('preserves exact versions and semver ranges', () => {
    expect(normalizeInstallVersionArgs(['plugin', 'install', 'memory-kit@1.2.3']))
      .toEqual(['plugin', 'install', 'memory-kit@1.2.3']);
    expect(normalizeInstallVersionArgs(['plugin', 'install', 'memory-kit@^1.2.0']))
      .toEqual(['plugin', 'install', 'memory-kit@^1.2.0']);
  });

  it('keeps the legacy add alias compatible while normalizing it', () => {
    expect(normalizeInstallVersionArgs(['plugin', 'add', 'memory-kit']))
      .toEqual(['plugin', 'add', 'memory-kit@*']);
  });

  it('preserves offline package paths so the native package router can handle them', () => {
    const args = normalizeInstallVersionArgs(['package', 'install', './release.dshpkg', '--dry-run']);
    expect(args).toEqual(['package', 'install', './release.dshpkg', '--dry-run']);
    expect(isPackageManagerV2Command(args)).toBe(true);
    expect(normalizeInstallVersionArgs(['package', 'install', 'C:\\Bundles\\RELEASE.DSHPKG'])).toEqual([
      'package', 'install', 'C:\\Bundles\\RELEASE.DSHPKG',
    ]);
    expect(isPackageManagerV2Command(['package', 'add', './release.dshpkg'])).toBe(true);
  });

  it('aligns dsh deep links with the same latest-stable request', () => {
    const plugin = new URL(normalizeDshInstallUri('dsh://plugin/install/memory-kit'));
    expect(decodeURIComponent(plugin.pathname)).toBe('/install/memory-kit@*');

    const typed = new URL(normalizeDshInstallUri('dsh://package/install/mcp/dsh-go-marketplace'));
    expect(decodeURIComponent(typed.pathname)).toBe('/install/mcp/dsh-go-marketplace@*');

    const marketplace = new URL(normalizeDshInstallUri('dsh://install?id=memory-kit&type=plugin'));
    expect(marketplace.searchParams.get('version')).toBe('*');
  });

  it('normalizes host handle requests before the existing host bridge executes', () => {
    const args = normalizeInstallVersionArgs(['host', 'handle', 'dsh://skill/install/code-review']);
    expect(decodeURIComponent(new URL(args[2]).pathname)).toBe('/install/code-review@*');
  });
});
