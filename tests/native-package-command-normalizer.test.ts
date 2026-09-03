import { describe, expect, it } from 'vitest';
import { normalizeInstallVersionArgs } from '../runtime/command-normalizer.mjs';

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
});
