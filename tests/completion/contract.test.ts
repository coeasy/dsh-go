import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DSH_API_VERSION, DSH_PLATFORM_VERSION, DSH_RUNTIME_VERSION, versionInfo } from '../../runtime/version.mjs';
import { toEcosystemItem } from '../../functions/_registry';

describe('stable 0.1.0 and API v1 contract', () => {
  it('keeps product, runtime and package metadata at 0.1.0', async () => {
    const root = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
    const site = JSON.parse(await readFile(join(process.cwd(), 'site', 'package.json'), 'utf8'));
    expect(root.version).toBe('0.1.0');
    expect(site.version).toBe('0.1.0');
    expect(DSH_PLATFORM_VERSION).toBe('0.1.0');
    expect(DSH_RUNTIME_VERSION).toBe('0.1.0');
    expect(DSH_API_VERSION).toBe('v1');
    expect(versionInfo()).toMatchObject({ platform: '0.1.0', runtime: '0.1.0', api: 'v1', default_package: '0.1.0' });
  });

  it('does not expose the accidental public API v2 search route', async () => {
    await expect(access(join(process.cwd(), 'functions', 'api', 'v2', 'search.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('builds type-aware install plans without changing the v1 route family', () => {
    const source = { provider: 'github', repo: 'owner/tool', ref: 'main', commit: 'a'.repeat(40) };
    const mcp = toEcosystemItem({
      id: 'shared', version: '0.1.0', runtime: { type: 'mcp' }, source,
      artifact: { integrity: 'sha256:test' }, metadata: { name: 'Shared MCP' }, capabilities: ['mcp'],
    });
    const skill = toEcosystemItem({
      id: 'shared', version: '0.1.0', runtime: { type: 'skill' }, source,
      artifact: { integrity: 'sha256:test' }, metadata: { name: 'Shared Skill' }, capabilities: ['skill'],
    });
    expect(mcp.key).toBe('mcp:shared');
    expect(skill.key).toBe('skill:shared');
    expect(mcp.local_install.command).toBe('dsh mcp install shared@0.1.0');
    expect(skill.local_install.command).toBe('dsh skill install shared@0.1.0');
    expect(mcp.local_install.deep_link).toContain('type=mcp');
  });
});
