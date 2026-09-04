import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyDeploymentPaths, githubOutputLines } from '../scripts/deployment-paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('Deployment V4 path authority', () => {
  it('defers the complete Sync V4-owned source set instead of racing direct deploys', () => {
    const result = classifyDeploymentPaths([
      'config/registry-v4-sources.json',
      'packages/dsh-go-marketplace-plugin/index.mjs',
      'scripts/audit-catalog-identity.mjs',
      'packages/protocol-core/index.mjs',
    ]);
    expect(result.sync_owned).toBe(true);
    expect(result.sync_owned_paths).toEqual([
      'config/registry-v4-sources.json',
      'packages/dsh-go-marketplace-plugin/index.mjs',
      'packages/protocol-core/index.mjs',
      'scripts/audit-catalog-identity.mjs',
    ]);
    expect(result.generated_registry).toBe(false);
  });

  it('recognizes generated Registry V4 publication as a separate protected authority', () => {
    const result = classifyDeploymentPaths(['catalog/registry-v4.json', 'catalog/meta.json']);
    expect(result.generated_registry).toBe(true);
    expect(result.sync_owned).toBe(false);
    expect(result.deploy_relevant).toBe(false);
  });

  it('deploys production payload changes but skips Runtime, tests and control-plane-only edits', () => {
    expect(classifyDeploymentPaths(['functions/api/v2/health.ts']).deploy_relevant).toBe(true);
    expect(classifyDeploymentPaths(['site/src/pages/index.astro']).deploy_relevant).toBe(true);
    expect(classifyDeploymentPaths(['catalog/provider-adapters.json']).deploy_relevant).toBe(true);
    expect(classifyDeploymentPaths(['scripts/copy-assets-core.mjs']).deploy_relevant).toBe(true);

    const runtimeOnly = classifyDeploymentPaths([
      'runtime/secret-provider.mjs',
      'tests/architecture-v4/secret-native-backends.test.ts',
      '.github/workflows/runtime-platform.yml',
    ]);
    expect(runtimeOnly).toMatchObject({
      sync_owned: false,
      generated_registry: false,
      deploy_relevant: false,
    });
  });

  it('normalizes changed paths and emits stable GitHub outputs', () => {
    const result = classifyDeploymentPaths(['./site/src/pages/index.astro', 'site\\src\\pages\\index.astro', '', 'runtime/dsh.mjs']);
    expect(result.paths).toEqual(['runtime/dsh.mjs', 'site/src/pages/index.astro']);
    expect(githubOutputLines(result)).toBe('sync_owned=false\ngenerated_registry=false\ndeploy_relevant=true');
  });

  it('wires Deploy Router to the classifier and suppresses non-payload fan-out', () => {
    const workflow = readFileSync(resolve(root, '.github/workflows/deploy-router.yml'), 'utf8');
    expect(workflow).toContain('node scripts/deployment-paths.mjs /tmp/changed-files');
    expect(workflow).toContain('Skip non-deploy source changes');
    expect(workflow).toContain("steps.changes.outputs.deploy_relevant == 'true'");
    expect(workflow).not.toContain('scripts/sync*.mjs|scripts/registry-v4-*.mjs');
  });
});
