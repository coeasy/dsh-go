import { describe, expect, it } from 'vitest';
import { createManifestTemplate, manifestType, normalizePackageManifest, validatePackageManifest } from '../../runtime/package-manifest.mjs';

describe('unified ecosystem manifest', () => {
  it('supports native plugin, mcp, skill and agent manifests', () => {
    expect(manifestType({}, 'dsh-plugin.json')).toBe('plugin');
    expect(manifestType({}, 'dsh-mcp.json')).toBe('mcp');
    expect(manifestType({}, 'dsh-skill.json')).toBe('skill');
    expect(manifestType({}, 'dsh-agent.json')).toBe('agent');
    expect(manifestType({}, 'dsh-package.json')).toBe('');
  });

  it('requires unified manifest version and type explicitly', () => {
    expect(validatePackageManifest({ name: 'Missing', version: '0.1.0', type: 'plugin' }, { file: 'dsh-package.json' }).errors).toContain('manifest_version must be 1.0.0');
    expect(validatePackageManifest({ manifest_version: '1.0.0', name: 'Missing', version: '0.1.0' }, { file: 'dsh-package.json' }).errors).toContain('type must be plugin, mcp, skill, or agent');
  });

  it('validates type-specific contracts', () => {
    const mcp: any = createManifestTemplate('mcp', { id: 'mcp-demo', name: 'MCP Demo' });
    mcp.mcp.command = 'node';
    expect(validatePackageManifest(mcp, { file: 'dsh-package.json', enforceDefaultVersion: true }).valid).toBe(true);
    const skill: any = createManifestTemplate('skill', { id: 'skill-demo', name: 'Skill Demo' });
    expect(validatePackageManifest(skill, { file: 'dsh-package.json' }).valid).toBe(true);
  });

  it('keeps security, publisher and compatibility declarations', () => {
    const manifest = normalizePackageManifest({
      manifest_version: '1.0.0', name: 'Agent', version: '0.1.0', type: 'agent',
      permissions: ['network', 'shell'], compatibility: { os: ['linux'] },
      publisher: { provider: 'github', id: 'coeasy' }, security: { license: 'MIT' },
      agent: { entrypoint: 'index.js' },
    }, 'dsh-package.json');
    expect(manifest?.permissions).toEqual(['network', 'shell']);
    expect(manifest?.publisher?.id).toBe('coeasy');
  });
});
