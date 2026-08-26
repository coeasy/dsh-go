import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = (name: string) => readFileSync(resolve(root, '.github/workflows', name), 'utf8');
const deployTargets = ['deploy.yml', 'deploy-pages.yml', 'deploy-mirror.yml', 'deploy-edgeone.yml'];

describe('authoritative deployment routing', () => {
  it('keeps Registry Sync narrow and incremental on code pushes', () => {
    const sync = workflow('sync.yml');

    expect(sync).toContain('- "scripts/sync*.mjs"');
    expect(sync).toContain('- "scripts/registry-pipeline-v3.mjs"');
    expect(sync).toContain('- "catalog/schema-v3.json"');
    expect(sync).toContain('- "catalog/overrides.json"');
    expect(sync).toContain('- ".github/workflows/sync.yml"');
    expect(sync).toContain('if [ "${{ github.event_name }}" = "push" ]; then MODE="incremental"; fi');
  });

  it('dispatches every deployment target with the authoritative Sync revision', () => {
    const sync = workflow('sync.yml');

    expect(sync).toContain('actions: write');
    expect(sync).toContain('commit_sha=$(git rev-parse HEAD)');
    expect(sync).toContain("if: github.event_name == 'push' || (steps.publish.outputs.pushed == 'true' && steps.diff.outputs.data_changed == 'true')");
    expect(sync).toContain('for workflow in deploy.yml deploy-pages.yml deploy-mirror.yml deploy-edgeone.yml; do');
    expect(sync).toContain('gh workflow run "$workflow" --ref main -f commit_sha="$SHA"');
  });

  it('routes ordinary pushes directly but defers Sync-owned paths', () => {
    const router = workflow('deploy-router.yml');

    expect(router).toContain('push:');
    expect(router).toContain('scripts/sync*.mjs|scripts/registry-pipeline-v3.mjs|catalog/schema-v3.json|catalog/overrides.json|.github/workflows/sync.yml');
    expect(router).toContain('generated_catalog=$GENERATED_CATALOG');
    expect(router).toContain('Generated catalog files are owned by Sync V3');
    expect(router).toContain('WORKFLOWS="deploy.yml deploy-pages.yml deploy-mirror.yml deploy-edgeone.yml"');
    expect(router).toContain('gh workflow run "$workflow" --ref main -f commit_sha="$SHA"');
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

  it('pins EdgeOne CLI and makes EdgeOne optional until the API token is configured', () => {
    const edgeone = workflow('deploy-edgeone.yml');

    expect(edgeone).toContain("EDGEONE_CLI_VERSION: ${{ vars.EDGEONE_CLI_VERSION || '1.6.28' }}");
    expect(edgeone).toContain('edgeone@${EDGEONE_CLI_VERSION}');
    expect(edgeone).toContain('makers deploy ./site/dist');
    expect(edgeone).toContain('secrets.EDGEONE_API_TOKEN');
    expect(edgeone).toContain('configured=false');
  });

  it('uses structured EdgeOne CI output and retries only transient transport failures', () => {
    const edgeone = workflow('deploy-edgeone.yml');

    expect(edgeone).toContain("EDGEONE_DEPLOY_RETRIES: ${{ vars.EDGEONE_DEPLOY_RETRIES || '3' }}");
    expect(edgeone).toContain('--json 2>&1');
    expect(edgeone).toContain("r.status!=='success' || !r.url || !r.projectId");
    expect(edgeone).toContain('fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network');
    expect(edgeone).toContain('EdgeOne deployment failed after retry policy');
  });

  it('preserves EdgeOne preview query credentials when checking Registry V3', () => {
    const edgeone = workflow('deploy-edgeone.yml');

    expect(edgeone).toContain("const u=new URL(process.env.EDGEONE_SITE_URL);u.pathname='/catalog/registry-v3.json';process.stdout.write(u.toString())");
    expect(edgeone).not.toContain('BASE_URL="${EDGEONE_SITE_URL%/}"');
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
