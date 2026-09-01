import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const workflowPath = (name: string) => join(root, '.github', 'workflows', name);
const workflow = (name: string) => readFileSync(workflowPath(name), 'utf8');

describe('CI and deployment hygiene', () => {
  it('consolidates legacy runtime and ecosystem CI without losing cross-platform coverage', () => {
    for (const obsolete of [
      'phase7-client-runtime.yml',
      'phase8-runtime-v3.yml',
      'ecosystem-ci.yml',
      'ecosystem-platform.yml',
      'runtime-platform-matrix.yml',
    ]) {
      expect(existsSync(workflowPath(obsolete))).toBe(false);
    }

    const runtime = workflow('runtime-platform.yml');
    expect(runtime).toContain('name: Runtime regression (ubuntu)');
    expect(runtime).toContain('runs-on: ubuntu-latest');
    expect(runtime).toContain('os: [windows-latest, macos-latest]');
    expect(runtime).toContain('npm run runtime:test');
    expect(runtime).toContain('npm run test:production-v2');
    expect(runtime).toContain('npm run completion:test');
    expect(runtime).toContain('npm run runtime:check');
    expect(runtime).not.toContain('cd site');
    expect(runtime).not.toContain('site/package-lock.json');

    const ci = workflow('ci.yml');
    expect(ci).toContain('npm run typecheck');
    expect(ci).toContain('npm run lint');
    expect(ci).toContain('npm test');
    expect(ci).toContain('cd site && npm run check');
  });

  it('keeps the release freeze gate fail-closed and reproducible', () => {
    const freeze = workflow('release-freeze.yml');
    expect(freeze).toContain('workflow_call:');
    expect(freeze).toContain('Release revision must be an exact 40-character SHA');
    expect(freeze).toContain('npm audit --audit-level=high');
    expect(freeze).toContain('npm run contract:check');
    expect(freeze).toContain('npm run registry:verify');
    expect(freeze).toContain('npm run runtime:check');
    expect(freeze).toContain('npm run deploy:gate');
    expect(freeze).toContain('Provider Adapter Registry gate');
    expect(freeze).toContain('npm test');
    expect(freeze).toContain('site/dist/catalog/provider-adapters.json');
    expect(freeze).toContain('npm pack --dry-run');
  });

  it('keeps Provider Adapter release tags and existing assets immutable', () => {
    const providerRelease = workflow('provider-adapter-release.yml');
    expect(providerRelease).toContain('Bind immutable release tag to source commit');
    expect(providerRelease).toContain('git check-ref-format "refs/tags/$TAG"');
    expect(providerRelease).toContain('git ls-remote --tags origin');
    expect(providerRelease).toContain('--verify-tag');
    expect(providerRelease).toContain('cmp "$asset" ".dsh-existing-release/$name"');
    expect(providerRelease).not.toContain('--clobber');
  });

  it('requires Provider Adapter Registry artifacts in every production deploy', () => {
    for (const name of ['deploy.yml', 'deploy-pages.yml', 'deploy-edgeone.yml']) {
      expect(workflow(name)).toContain('site/dist/catalog/provider-adapters.json');
    }
  });

  it('publishes bounded catalog artifacts and enforces provider file limits', () => {
    const deploy = workflow('deploy.yml');
    const edgeone = workflow('deploy-edgeone.yml');
    const gate = readFileSync(join(root, 'scripts', 'deploy-gate-v3.mjs'), 'utf8');
    expect(deploy).toContain('site/dist/catalog/plugins.json');
    expect(deploy).toContain('site/dist/catalog/catalog-v3/index.json');
    expect(deploy).toContain('Validate Cloudflare Pages file limits');
    expect(deploy).toContain('find site/dist -type f -size +26214400c');
    expect(deploy).toContain('pages deploy site/dist');
    expect(edgeone).toContain('Validate EdgeOne static file limits');
    expect(edgeone).toContain('find site/dist -type f -size +26214400c');
    expect(gate).toContain('MAX_PUBLIC_REGISTRY_BYTES = 24 * 1024 * 1024');
    expect(gate).toContain('registry-v3.json exceeds the 24 MiB public single-file budget');
    expect(deploy).not.toContain('rm -f .deploy/cloudflare/catalog/plugins.json');
  });

  it('keeps EdgeOne production verification on a stable target and native upload config', () => {
    const edgeone = workflow('deploy-edgeone.yml');
    const edgeoneConfig = readFileSync(join(root, 'site', 'public', 'edgeone.json'), 'utf8');
    expect(edgeone).toContain("EDGEONE_SITE_URL: ${{ vars.EDGEONE_SITE_URL || '' }}");
    expect(edgeone).toContain('CLI production URL');
    expect(edgeone).toContain('DEPLOY_BASE_URL: ${{ vars.EDGEONE_SITE_URL || steps.edgeone.outputs.deploy_url }}');
    expect(edgeone).not.toContain('DEPLOY_BASE_URL: ${{ steps.edgeone.outputs.health_url }}');
    expect(edgeone).toContain('production target: ${{ vars.EDGEONE_SITE_URL || \'CLI production URL\' }}');
    expect(edgeone).toContain('site/dist/edgeone.json');
    expect(edgeoneConfig).toContain('"source": "/version.json"');
    expect(edgeoneConfig).toContain('no-store, no-cache, must-revalidate');
  });

  it('monitors Provider Adapter Registry convergence across every production host without env-sized Registry payloads', () => {
    const monitor = workflow('monitor.yml');
    expect(monitor).toContain('/api/v1/providers?per_page=1');
    expect(monitor).toContain('PROVIDER_MAIN_HASH');
    expect(monitor).toContain('PROVIDER_MAIN_COUNT');
    expect(monitor).toContain('/catalog/provider-adapters.json');
    expect(monitor).toContain('Provider Adapter Registry converged');
    expect(monitor).toContain('Enforce final production smoke gates');
    expect(monitor).toContain('SMOKE_DIR=$(mktemp -d)');
    expect(monitor).toContain('$SMOKE_DIR/registry.json');
    expect(monitor).not.toContain('REGISTRY="$REGISTRY"');
    expect(monitor).not.toContain('META="$META"');
    expect(monitor).toContain('no stable custom domain configured');
  });

  it('automatically removes merged same-repository branches and preserves a safe manual cleanup', () => {
    const hygiene = workflow('branch-hygiene.yml');
    expect(hygiene).toContain('types: [closed]');
    expect(hygiene).not.toContain('synchronize');
    expect(hygiene).toContain("github.event.pull_request.merged == true");
    expect(hygiene).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(hygiene).toContain("gh pr list --repo \"$GITHUB_REPOSITORY\" --state open");
    expect(hygiene).toContain('encoded="$(jq -rn --arg value "$branch" \'$value|@uri\')"');
    expect(hygiene).toContain('git/refs/heads/$encoded');
  });
});
