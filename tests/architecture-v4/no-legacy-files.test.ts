import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function exists(path: string) {
  try { await access(resolve(path)); return true; } catch { return false; }
}

describe('no legacy compatibility surfaces', () => {
  it('does not retain obsolete Runtime, Registry, Sync, Search, API, marketplace, deployment or ecosystem runtimes', async () => {
    const forbidden = [
      'DEPLOYMENT_V2.md',
      'DEPLOY_GUIDE.md',
      'FIRST_DEPLOY_CHECKLIST.md',
      'bin/dsh-core.mjs',
      'marketplace',
      'mcp/v1',
      'profiles/v1',
      'skills/v1',
      'agents/v1',
      'functions/api/v1',
      'functions/_package-request.ts',
      'functions/_registry.ts',
      'functions/_marketplace-v4.ts',
      'runtime/v3',
      'runtime/package-model.mjs',
      'runtime/semver.mjs',
      'runtime/resolver.mjs',
      'runtime/solver-v2.mjs',
      'runtime/catalog.mjs',
      'runtime/registry-distribution.mjs',
      'runtime/cli.mjs',
      'runtime/control-cli.mjs',
      'scripts/deploy-gate-v3.mjs',
      'scripts/registry-v3-builder.mjs',
      'scripts/registry-pipeline-v3.mjs',
      'scripts/registry-builder.mjs',
      'scripts/registry-distribution.mjs',
      'scripts/catalog-distribution.mjs',
      'scripts/validate.mjs',
      'scripts/sync.mjs',
      'scripts/sync-v3.mjs',
      'scripts/sync-v3-final.mjs',
      'scripts/build-search-index-v2.mjs',
      'schemas/dsh-marketplace-discovery.schema.json',
      'schemas/dsh-package.schema.json',
      'site/public/schemas/dsh-marketplace-discovery.schema.json',
      'site/src/pages/plugin/[slug].astro',
      'site/src/pages/ecosystem/[id].astro',
      'site/src/components/UnifiedMarketplace.astro',
    ];
    for (const path of forbidden) expect(await exists(path), path).toBe(false);
  });

  it('publishes only canonical Manifest V2 package manifests with no compatibility marker', async () => {
    for (const file of [
      'dsh-package.json',
      'packages/dsh-go-marketplace/dsh-package.json',
      'packages/dsh-go-marketplace-plugin/dsh-package.json',
    ]) {
      const manifest = JSON.parse(await readFile(resolve(file), 'utf8'));
      expect(manifest.manifest_version, file).toBe(2);
      expect(manifest, file).not.toHaveProperty('schema_version');
      expect(manifest.publisher?.id, file).toBeTruthy();
      expect(manifest.security, file).toBeTypeOf('object');
    }
  });

  it('keeps canonical deployment workflows on V4 while permitting fail-closed absence guards', async () => {
    const workflows = [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      '.github/workflows/deploy-pages.yml',
      '.github/workflows/deploy-edgeone.yml',
      '.github/workflows/phase-e-validation.yml',
      '.github/workflows/runtime-platform.yml',
    ];
    for (const path of workflows) {
      const text = await readFile(resolve(path), 'utf8');
      expect(text, path).not.toContain('Deploy Gate V3');
      expect(text, path).not.toContain('node scripts/deploy-gate-v3.mjs');
      expect(text, path).not.toContain('node scripts/registry-v3-builder.mjs');
      expect(text, path).not.toContain('node scripts/sync-v3.mjs');
      if (path.includes('deploy') || path.includes('ci') || path.includes('phase-e')) expect(text, path).toContain('registry-v4');
    }
  });

  it('keeps public docs and machine discovery free of old API and install syntax', async () => {
    for (const path of ['README.md', 'DEPLOYMENT.md', 'site/public/openapi.json', 'site/public/.well-known/dsh-marketplace.json']) {
      const text = await readFile(resolve(path), 'utf8');
      expect(text, path).not.toContain('/api/v1');
      expect(text, path).not.toMatch(/\bdsh\s+(plugin|mcp|skill|agent)\s+install\b/);
      expect(text, path).not.toContain('dsh://plugin/install');
      expect(text, path).not.toContain('dsh://install?');
    }
    expect(await exists('site/public/schemas/dsh-marketplace-discovery-v2.schema.json')).toBe(true);
  });
});
