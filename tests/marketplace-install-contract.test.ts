import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildMarketplaceInstallPlan } from '../site/src/lib/install-command';

const MARKETPLACE_INSTALL_SOURCES = [
  'site/src/components/PluginCard.astro',
  'site/src/pages/plugin/[slug].astro',
  'site/src/i18n/dict.ts',
];

describe('Marketplace install contract', () => {
  it('builds typed commands and canonical Deep Links for every package type', () => {
    for (const type of ['plugin', 'mcp', 'skill', 'agent'] as const) {
      const plan = buildMarketplaceInstallPlan({ type, id: 'owner/example', version: '1.2.3' });
      expect(plan.command).toBe(`dsh ${type} install owner/example@1.2.3`);
      const url = new URL(plan.deepLink);
      expect(url.protocol).toBe('dsh:');
      expect(url.hostname).toBe('install');
      expect(url.searchParams.get('id')).toBe('owner/example');
      expect(url.searchParams.get('version')).toBe('1.2.3');
      expect(url.searchParams.get('channel')).toBe('stable');
      expect(url.searchParams.get('type')).toBe(type);
      expect(url.searchParams.has('plugin')).toBe(false);
    }
  });

  it('keeps versionless requests latest-compatible and carries channel/registry explicitly', () => {
    const plan = buildMarketplaceInstallPlan({
      type: 'mcp',
      id: 'dsh-go-marketplace',
      channel: 'beta',
      registry: 'company',
    });
    expect(plan.command).toBe('dsh mcp install dsh-go-marketplace --channel beta --registry company');
    expect(plan.versionRange).toBe('*');
    const url = new URL(plan.deepLink);
    expect(url.searchParams.get('version')).toBe('*');
    expect(url.searchParams.get('channel')).toBe('beta');
    expect(url.searchParams.get('registry')).toBe('company');
  });

  it('fails CI if Marketplace sources regress to legacy add or plugin-only Deep Links', async () => {
    for (const file of MARKETPLACE_INSTALL_SOURCES) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toContain('dsh plugin add');
      expect(source, file).not.toContain('dsh://install?plugin=');
    }
  });
});
