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

  it('dispatches every production target plus final smoke with the authoritative Sync revision', () => {
    const sync = workflow('sync.yml');
    expect(sync).toContain('actions: write');
    expect(sync).toContain('commit_sha=$(git rev-parse HEAD)');
    expect(sync).toContain("if: github.event_name == 'push' || (steps.publish.outputs.pushed == 'true' && steps.diff.outputs.data_changed == 'true')");
    expect(sync).toContain('DEPLOY_REVISION: ${{ steps.publish.outputs.commit_sha }}');
    expect(sync).toContain('DEPLOY_WORKFLOWS: deploy.yml deploy-pages.yml deploy-edgeone.yml monitor.yml');
    expect(sync).not.toContain('deploy-mirror.yml');
    expect(sync).not.toContain('CN Mirrors');
    expect(sync).toContain('run: node scripts/dispatch-deployments.mjs');
    expect(sync).toContain("steps.dispatch.outputs.dispatch_failures || 'none'");
    expect(sync).toContain('DEPLOY_WAIT_TIMEOUT_MS: "2100000"');
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
    expect(router).toContain('WORKFLOWS="deploy.yml deploy-pages.yml deploy-edgeone.yml monitor.yml"');
    expect(router).not.toContain('deploy-mirror.yml');
    expect(router).not.toContain('CN Mirrors');
    expect(router).toContain('SHA=$(git rev-parse HEAD)');
    expect(router).toContain('DEPLOY_REVISION: ${{ steps.changes.outputs.revision }}');
    expect(router).toContain('timeout-minutes: 40');
    expect(router).toContain('DEPLOY_WAIT_TIMEOUT_MS: "2100000"');
    expect(router).toContain('run: node scripts/dispatch-deployments.mjs');
  });

  it('supports selective manual redeploys and always follows them with final smoke', () => {
    const router = workflow('deploy-router.yml');
    expect(router).toContain('target:');
    expect(router).toContain('- cloudflare');
    expect(router).toContain('- github-pages');
    expect(router).toContain('- edgeone');
    expect(router).not.toContain('- mirrors');
    expect(router).toContain('WORKFLOWS="deploy-edgeone.yml monitor.yml"');
    expect(router).toContain('WORKFLOWS="deploy.yml monitor.yml"');
    expect(router).toContain('WORKFLOWS="deploy-pages.yml monitor.yml"');
    expect(router).toContain("group: deploy-router-${{ github.ref }}-${{ inputs.target || 'all' }}");
  });

  it('keeps provider workflows dispatch-only and pinned to an explicit revision', () => {
    for (const name of deployTargets) {
      const deploy = workflow(name);
      expect(deploy, name).toContain('workflow_dispatch:');
      expect(deploy, name).not.toMatch(/on:\n\s+push:/);
      expect(deploy, name).toContain('commit_sha:');
      expect(deploy, name).toContain('DEPLOYMENT_SHA: ${{ inputs.commit_sha || github.sha }}');
      expect(deploy, name).toContain('ref: ${{ env.DEPLOYMENT_SHA }}');
      expect(deploy, name).toContain('Deployment revision mismatch');
    }
  });

  it('stamps deployment identity before every static build and verifies exact SHA after deployment', () => {
    for (const name of ['deploy.yml', 'deploy-pages.yml']) {
      const deploy = workflow(name);
      expect(deploy, name).toContain('Prepare deployment identity before build');
      expect(deploy, name).toContain('write-deployment-version.mjs site/public/version.json');
      expect(deploy, name).toContain('test -f site/dist/version.json');
      expect(deploy, name).toContain('run: node scripts/check-production-sha.mjs');
      expect(deploy, name).toContain('EXPECTED_DEPLOYMENT_SHA: ${{ env.DEPLOYMENT_SHA }}');
    }
  });

  it('preserves hidden discovery directories in GitHub Pages artifacts', () => {
    const deploy = workflow('deploy-pages.yml');
    expect(deploy).toContain('touch site/dist/.nojekyll');
    expect(deploy).toContain('include-hidden-files: true');
    expect(deploy).toContain('test -f site/dist/.nojekyll');
  });

  it('uses the supported Cloudflare Wrangler action instead of deprecated pages-action', () => {
    const deploy = workflow('deploy.yml');
    expect(deploy).toContain('uses: cloudflare/wrangler-action@v4');
    expect(deploy).toContain('pages deploy site/dist');
    expect(deploy).toContain('site/dist/catalog/catalog-v3/index.json');
    expect(deploy).toContain('--commit-hash=${{ env.DEPLOYMENT_SHA }}');
    expect(deploy).not.toContain('cloudflare/pages-action@v1');
  });

  it('keeps EdgeOne fail-closed and makes version metadata a first-class build asset', () => {
    const edgeone = workflow('deploy-edgeone.yml');
    expect(edgeone).toContain("EDGEONE_CLI_VERSION: ${{ vars.EDGEONE_CLI_VERSION || '1.6.28' }}");
    expect(edgeone).toContain("EDGEONE_SITE_URL: ${{ vars.EDGEONE_SITE_URL || '' }}");
    expect(edgeone).toContain('secrets.EDGEONE_API_TOKEN');
    expect(edgeone).toContain('EDGEONE_API_TOKEN secret is required for production deployment');
    expect(edgeone).toContain('CLI production URL');
    expect(edgeone).toContain('Checkout current deployment control plane');
    expect(edgeone).toContain('ref: ${{ github.sha }}');
    expect(edgeone).toContain('path: .ci-control');
    expect(edgeone).toContain('Deployment control revision mismatch');
    expect(edgeone).toContain('run: node .ci-control/scripts/write-deployment-version.mjs site/public/version.json');
    expect(edgeone).not.toContain('write-deployment-version.mjs site/dist/version.json');
    expect(edgeone).toContain('test -f site/dist/edgeone.json');
    expect(edgeone).toContain('Validate EdgeOne static file limits');
    expect(edgeone).toContain('run: node .ci-control/scripts/edgeone-deploy-ci.mjs --check');
    expect(edgeone).toContain('run: node .ci-control/scripts/check-production-sha.mjs');
    expect(edgeone).toContain('DEPLOY_BASE_URL: ${{ vars.EDGEONE_SITE_URL || steps.edgeone.outputs.deploy_url }}');
    expect(edgeone).not.toContain('DEPLOY_BASE_URL: ${{ steps.edgeone.outputs.health_url }}');
    expect(edgeone).toContain('Production Registry V3 convergence gate');
    expect(edgeone).toContain('production target: ${{ vars.EDGEONE_SITE_URL || \'CLI production URL\' }}');
    expect(edgeone.length).toBeLessThan(18_000);
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

  it('makes final production smoke exact-revision, cross-provider, and fail-closed', () => {
    const monitor = workflow('monitor.yml');
    expect(monitor).toContain('commit_sha:');
    expect(monitor).toContain('DEPLOYMENT_SHA: ${{ inputs.commit_sha || github.sha }}');
    expect(monitor).toContain('ref: ${{ env.DEPLOYMENT_SHA }}');
    expect(monitor).not.toContain('ref: main');
    expect(monitor).toContain("EDGEONE_SITE_URL: ${{ vars.EDGEONE_SITE_URL || '' }}");
    expect(monitor).toContain('no stable custom domain configured');
    expect(monitor).toContain('Check Cloudflare exact SHA');
    expect(monitor).toContain('Check GitHub Pages exact SHA');
    expect(monitor).toContain('Check EdgeOne exact SHA');
    expect(monitor).toContain('run: node scripts/check-production-sha.mjs');
    expect(monitor).toContain('run: node scripts/check-deployment-convergence.mjs');
    expect(monitor).toContain('Check Provider Adapter Registry on all static targets');
    expect(monitor).toContain('Enforce final production smoke gates');
    expect(monitor).toContain('All production targets converged to ${DEPLOYMENT_SHA}');
  });
});
