import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function exists(path: string) {
  try { await access(resolve(path)); return true; } catch { return false; }
}

describe('no legacy compatibility surfaces', () => {
  it('does not retain obsolete Runtime, Registry, Sync, Search, API or detail-route implementations', async () => {
    const forbidden = [
      'functions/api/v1',
      'runtime/v3',
      'runtime/package-model.mjs',
      'runtime/semver.mjs',
      'runtime/resolver.mjs',
      'runtime/solver-v2.mjs',
      'runtime/package-manager-v2-cli.mjs',
      'runtime/manifest-v2.mjs',
      'scripts/deploy-gate-v3.mjs',
      'scripts/build-search-index-v2.mjs',
      'scripts/sync-v3.mjs',
      'scripts/registry-v3-builder.mjs',
      'scripts/registry-pipeline-v3.mjs',
      'site/src/pages/plugin/[slug].astro',
      'site/src/pages/ecosystem/[id].astro',
      'site/src/i18n/legacy-page-text.ts',
    ];
    for (const path of forbidden) expect(await exists(path), `${path} must not exist`).toBe(false);
  });

  it('publishes only Manifest V2 package manifests', async () => {
    for (const path of ['dsh-package.json', 'packages/dsh-go-marketplace/dsh-package.json', 'packages/dsh-go-marketplace-plugin/dsh-package.json']) {
      const manifest = JSON.parse(await readFile(resolve(path), 'utf8'));
      expect(manifest.schema_version, path).toBe(2);
      expect(['plugin', 'mcp', 'skill', 'agent']).toContain(manifest.type);
      expect(manifest.id, path).toBeTruthy();
      expect(manifest.version, path).toMatch(/^\d+\.\d+\.\d+/);
      expect(manifest.runtime, path).toBeTypeOf('object');
      expect(manifest.entrypoints, path).toBeTypeOf('object');
    }
  });

  it('does not reference legacy public APIs from canonical deployment workflows', async () => {
    const workflows = [
      '.github/workflows/deploy.yml',
      '.github/workflows/deploy-pages.yml',
      '.github/workflows/deploy-edgeone.yml',
      '.github/workflows/deploy-router.yml',
      '.github/workflows/monitor.yml',
      '.github/workflows/sync.yml',
      '.github/workflows/release-freeze.yml',
      '.github/workflows/package-release.yml',
    ];
    for (const path of workflows) {
      const text = await readFile(resolve(path), 'utf8');
      expect(text, path).not.toContain('/api/v1');
      expect(text, path).not.toContain('Deploy Gate V3');
      expect(text, path).not.toContain('registry-v3.json');
      expect(text, path).not.toContain('search-index-v2.json');
    }
  });
});
