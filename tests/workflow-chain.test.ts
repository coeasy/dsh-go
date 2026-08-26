import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = (name: string) => readFileSync(resolve(root, '.github/workflows', name), 'utf8');
const script = (name: string) => readFileSync(resolve(root, 'scripts', name), 'utf8');
const deployTargets = ['deploy.yml', 'deploy-pages.yml', 'deploy-mirror.yml', 'deploy-edgeone.yml'];
const registryOwnedScripts = [
  'scripts/registry-pipeline-v3.mjs',
  'scripts/registry-v3-builder.mjs',
  'scripts/repository-identity.mjs',
  'scripts/github-discovery.mjs',
  'scripts/checksum.mjs',
  'scripts/validate-registry-v3.mjs',
];

describe('authoritative deployment routing', () => {
  it('keeps Registry Sync narrow, incremental, and complete over Registry-producing code', () => {
    const sync = workflow('sync.yml');

    expect(sync).toContain('- "scripts/sync*.mjs"');
    for (const path of registryOwnedScripts) expect(sync, path).toContain(`- "${path}"`);
    expect(sync).toContain('- "catalog/schema-v3.json"');
    expect(sync).toContain('- "catalog/overrides.json"');
    expect(sync).toContain('- ".github/workflows/sync.yml"');
    expect(sync).toContain('if [ "${{ github.event_name }}" = "push" ]; then MODE="incremental"; fi');
  });

  it('dispatches every deployment target with the authoritative Sync revision through the resilient fan-out helper', () => {
    const sync = workflow('sync.yml');

    expect(sync).toContain('actions: write');
    expect(sync).toContain('commit_sha=$(git rev-parse HEAD)');
    expect(sync).toContain("if: github.event_name == 'push' || (steps.publish.outputs.pushed == 'true' && steps.diff.outputs.data_changed == 'true')");
    expect(sync).toContain('DEPLOY_REVISION: ${{ steps.publish.outputs.commit_sha }}');
    expect(sync).toContain('DEPLOY_WORKFLOWS: deploy.yml deploy-pages.yml deploy-mirror.yml deploy-edgeone.yml');
    expect(sync).toContain('run: node scripts/dispatch-deployments.mjs');
    expect(sync).toContain("steps.dispatch.outputs.dispatch_failures || 'none'");
  });

  it('routes ordinary pushes directly but defers every Registry-owned producer path', () => {
    const router = workflow('deploy-router.yml');

    expect(router).toContain('push:');
    expect(router).toContain('scripts/sync*.mjs');
    for (const path of registryOwnedScripts) expect(router, path).toContain(path);
    expect(router).toContain('catalog/schema-v3.json');
    expect(router).toContain('catalog/overrides.json');
    expect(router).toContain('.github/workflows/sync.yml');
    expect(router).toContain('generated_catalog=$GENERATED_CATALOG');
    expect(router).toContain('Generated catalog files are owned by Sync V3');
    expect(router).toContain('WORKFLOWS="deploy.yml deploy-pages.yml deploy-mirror.yml deploy-edgeone.yml"');
    expect(router).toContain('SHA=$(git rev-parse HEAD)');
    expect(router).toContain('DEPLOY_REVISION: ${{ steps.changes.outputs.revision }}');
    expect(router).toContain('run: node scripts/dispatch-deployments.mjs');
  });

  it('supports selective manual redeploys without changing push fan-out', () => {
    const router = workflow('deploy-router.yml');

    expect(router).toContain('target:');
    expect(router).toContain('- cloudflare');
    expect(router).toContain('- github-pages');
    expect(router).toContain('- mirrors');
    expect(router).toContain('- edgeone');
    expect(router).toContain('WORKFLOWS="deploy-edgeone.yml"');
    expect(router).toContain('WORKFLOWS="deploy.yml"');
    expect(router).toContain("group: deploy-router-${{ github.ref }}-${{ inputs.target || 'all' }}");
  });

  it('keeps provider workflows dispatch-only and pinned to an explicit revision', () => {
    for (const name of deployTargets) {
      const deploy = workflow(name);
      expect(deploy, name).toContain('workflow_dispatch:');
      expect(deploy, name).not.toMatch(/on:\n\s+push:/);
      expect(deploy, name).toContain('commit_sha:');
      expect(deploy, name).toContain('ref: ${{ inputs.commit_sha || github.sha }}');
      expect(deploy, name).toContain('Deployment revision mismatch');
    }
  });

  it('uses the supported Cloudflare Wrangler action instead of deprecated pages-action', () => {
    const deploy = workflow('deploy.yml');

    expect(deploy).toContain('uses: cloudflare/wrangler-action@v4');
    expect(deploy).toContain('pages deploy site/dist');
    expect(deploy).toContain('--commit-hash=${{ inputs.commit_sha || github.sha }}');
    expect(deploy).not.toContain('cloudflare/pages-action@v1');
  });

  it('keeps the EdgeOne workflow indexer-friendly by moving deployment logic into a tested script', () => {
    const edgeone = workflow('deploy-edgeone.yml');
    const edgeoneScript = script('edgeone-deploy-ci.mjs');

    expect(edgeone).toContain("EDGEONE_CLI_VERSION: ${{ vars.EDGEONE_CLI_VERSION || '1.6.28' }}");
    expect(edgeone).toContain('secrets.EDGEONE_API_TOKEN');
    expect(edgeone).toContain('configured=false');
    expect(edgeone).toContain('run: node scripts/edgeone-deploy-ci.mjs --check');
    expect(edgeone).toContain('run: node scripts/edgeone-deploy-ci.mjs');
    expect(edgeone).not.toContain("<<'NODE'");
    expect(edgeone.length).toBeLessThan(12_000);

    expect(edgeoneScript).toContain("'-t',");
    expect(edgeoneScript).toContain("'--json'");
    expect(edgeoneScript).toContain('using per-invocation token auth');
    expect(edgeoneScript).toContain('EdgeOne CLI >= 1.6.0 is required');
    expect(edgeoneScript).not.toContain('login --token');
    expect(edgeoneScript).not.toContain('whoami');
  });

  it('uses one Registry V3 convergence implementation across static providers', () => {
    for (const name of ['deploy.yml', 'deploy-pages.yml', 'deploy-edgeone.yml']) {
      const deploy = workflow(name);
      expect(deploy, name).toContain('run: node scripts/check-deployment-convergence.mjs');
      expect(deploy, name).not.toContain('curl -fsS --max-time 20');
    }

    const convergence = script('check-deployment-convergence.mjs');
    expect(convergence).toContain("new URL('catalog/registry-v3.json', base)");
    expect(convergence).toContain('registry_version !== 3');
    expect(convergence).toContain('content_hash');
    expect(convergence).toContain('AbortSignal.timeout(timeoutMs)');
  });

  it('centralizes dispatch retry semantics so one provider cannot prevent later providers from being attempted', () => {
    const dispatch = script('dispatch-deployments.mjs');

    expect(dispatch).toContain('for (const workflow of workflows)');
    expect(dispatch).toContain('isWorkflowRegistrationError(lastError)');
    expect(dispatch).toContain('results.push({ workflow, status, runUrl, error: lastError, attempts: attemptsUsed })');
    expect(dispatch).toContain("writeOutput('dispatch_failures'");
    expect(dispatch).toContain('Deployment fan-out completed with');
  });

  it('gates deployed Registry V3 against the latest main registry', () => {
    const monitor = workflow('monitor.yml');

    expect(monitor).toContain('uses: actions/checkout@v7');
    expect(monitor).toContain('ref: main');
    expect(monitor).toContain('MAIN_HASH=');
    expect(monitor).toContain('MAIN_COUNT=');
    expect(monitor).toContain('META_HASH=');
    expect(monitor).toContain('REG_HASH=');
    expect(monitor).toContain('API_HASH=');
    expect(monitor).toContain('Deployed Registry V3 did not converge to main');
  });
});
