import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { sanitizeManifest } from '../../scripts/sync.mjs';

describe('native ecosystem discovery', () => {
  it('recognizes unified and type-native manifests', () => {
    expect(sanitizeManifest({ name: 'Unified', type: 'agent', agent: { entrypoint: 'index.js' } }, 'dsh-package.json')).toMatchObject({ type: 'agent', metadata_source: 'dsh-package' });
    expect(sanitizeManifest({ name: 'MCP', mcp: { transport: 'stdio', command: 'node' } }, 'dsh-mcp.json')).toMatchObject({ type: 'mcp', metadata_source: 'dsh-mcp' });
    expect(sanitizeManifest({ name: 'Legacy' }, 'dsh-plugin.json')).not.toHaveProperty('type');
  });

  it('keeps native topics and terminal manifest filtering wired into Sync V3', async () => {
    const source = await readFile(new URL('../../scripts/sync.mjs', import.meta.url), 'utf8');
    expect(source).toContain("'topic:dsh-package'");
    expect(source).toContain("'topic:dsh-mcp'");
    expect(source).toContain("'topic:dsh-skill'");
    expect(source).toContain("'topic:dsh-agent'");
    expect(source).toContain('repo.__extra && !isAuthoritativeManifestFile(p.manifest_file)');
    expect(source).toContain('...NATIVE_ECOSYSTEM_TOPICS');
  });
});
