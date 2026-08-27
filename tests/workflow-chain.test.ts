import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = (name: string) => readFileSync(resolve(root, '.github/workflows', name), 'utf8');
const deployTargets = ['deploy.yml', 'deploy-pages.yml', 'deploy-edgeone.yml'];
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
    expect(sync).toContain('DEPLOY_WORKFLOWS: deploy.yml deploy-pages.yml deploy-edgeone.yml');
    expect(sync).not.toContain('deploy-mirror.yml');
    expect(sync).not.toContain('CN Mirrors');
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
    expect(router).toContain('WORKFLOWS="deploy.yml deploy-pages.yml deploy-edgeone.yml"');
    expect(router).not.toContain('deploy-mirror.yml');
    expect(router).not.toContain('CN Mirrors');
    expect(router).toContain('SHA=$(git rev-parse HEAD)');
    expect(router).toContain('DEPLOY_REVISION: ${{ steps.changes.outputs.revision }}');
    expect(router).toContain('run: node scripts/dispatch-deployments.mjs');
  });

  it('supports selective manual redeploys without changing push fan-out', () => {
    const router = workflow('deploy-router.yml');

    expect(router).toContain('target:');
    expect(router).toContain('- cloudflare');
    expect(router).toContain('- github-pages');
    expect(router).toContain('- edgeone');
    expect(router).not.toContain('- mirrors');
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
      if (name === 'deploy-edgeone.yml') {
        expect(deploy, name).toContain('DEPLOYMENT_SHA: ${{ inputs.commit_sha || github.sha }}');
        expect(deploy, name).toContain('ref: ${{ env.DEPLOYMENT_SHA }}');
      } else {
        expect(deploy, name).toContain('ref: ${{ inputs.commit_sha || github.sha }}');
      }
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

  it('keeps EdgeOne workflow wiring fail-closed until production reaches the exact SHA', () => {
    const edgeone = workflow('deploy-edgeone.yml');

    expect(edgeone).toContain("EDGEONE_CLI_VERSION: ${{ vars.EDGEONE_CLI_VERSION || '1.6.28' }}");
    expect(edgeone).toContain('DEPLOYMENT_SHA: ${{ inputs.commit_sha || github.sha }}');
    expect(edgeone).toContain('secrets.EDGEONE_API_TOKEN');
    expect(edgeone).toContain('token_configured=false');
    expect(edgeone).toContain('site_url_configured=false');
    expect(edgeone).toContain('EDGEONE_API_TOKEN secret is required for production deployment');
    expect(edgeone).not.toContain('EDGEONE_SITE_URL repository variable is required for production SHA verification');
    expect(edgeone).not.toContain("steps.edgeone-config.outputs.site_url_configured == 'true'");
    expect(edgeone).toContain('PUBLIC_SITE_URL: ${{ vars.EDGEONE_SITE_URL }}');
    expect(edgeone).toContain('Checkout current deployment control plane');
    expect(edgeone).toContain('ref: ${{ github.sha }}');
    expect(edgeone).toContain('path: .ci-control');
    expect(edgeone).toContain('CONTROL=$(git -C .ci-control rev-parse HEAD)');
    expect(edgeone).toContain('Deployment control revision mismatch');
    expect(edgeone).toContain('run: node .ci-control/scripts/write-deployment-version.mjs site/dist/version.json');
    expect(edgeone).toContain('run: node .ci-control/scripts/edgeone-deploy-ci.mjs --check');
    expect(edgeone).toContain('run: node .ci-control/scripts/edgeone-deploy-ci.mjs');
    expect(edgeone).toContain('run: node .ci-control/scripts/check-production-sha.mjs');
    expect(edgeone).toContain('DEPLOY_BASE_URL: ${{ steps.edgeone.outputs.deploy_url }}');
    expect(edgeone).toContain('DEPLOY_BASE_URL: ${{ steps.edgeone.outputs.health_url }}');
    expect(edgeone).toContain('production target fallback: CLI production deployment URL when EDGEONE_SITE_URL is unset');
    expect(edgeone).toContain('Production Registry V3 convergence gate');
    expect(edgeone).toContain('control plane SHA: ${GITHUB_SHA}');
    expect(edgeone).not.toContain("<<'NODE'");
    expect(edgeone.length).toBeLessThan(14_000);
  });

  it('uses one Registry V3 convergence helper across static providers', () => {
    for (const name of ['deploy.yml', 'deploy-pages.yml']) {
      const deploy = workflow(name);
      expect(deploy, name).toContain('run: node scripts/check-deployment-convergence.mjs');
      expect(deploy, name).not.toContain('curl -fsS --max-time 20');
    }

    const edgeone = workflow('deploy-edgeone.yml');
    expect(edgeone).toContain('run: node .ci-control/scripts/check-deployment-convergence.mjs');
    expect(edgeone).not.toContain('curl -fsS --max-time 20');
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
