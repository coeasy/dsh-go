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
    expect(ci).toContain('node scripts/npm-audit-retry.mjs --label root');
    expect(ci).toContain('node scripts/npm-audit-retry.mjs --cwd site --label site');
  });

  it('bounds every externally waiting release and validation job', () => {
    expect(workflow('phase-e-validation.yml')).toContain('timeout-minutes: 30');
    expect(workflow('provider-adapter-marketplace.yml')).toContain('timeout-minutes: 20');
    expect(workflow('provider-adapter-release.yml')).toContain('timeout-minutes: 30');
    expect(workflow('release.yml')).toContain('timeout-minutes: 10');
    expect(workflow('release.yml')).toContain('timeout-minutes: 30');
  });

  it('keeps the release freeze gate fail-closed and reproducible', () => {
    const freeze = workflow('release-freeze.yml');
    expect(freeze).toContain('workflow_call:');
    expect(freeze).toContain('Release revision must be an exact 40-character SHA');
    expect(freeze).toContain('node scripts/npm-audit-retry.mjs --label root');
    expect(freeze).toContain('node scripts/npm-audit-retry.mjs --cwd site --label site');
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
      expect(workflow(name)).toContain('test -f site/dist/publishers/index.html');
    }
  });

  it('publishes bounded catalog artifacts and enforces provider file limits', () => {
    const deploy = workflow('deploy.yml');
    const edgeone = workflow('deploy-edgeone.yml');
    const gate = readFileSync(join(root, 'scripts', 'deploy-gate-v3.mjs'), 'utf8');
    expect(deploy).toContain('site/dist/catalog/plugins.json');
    expect(deploy).toContain('site/dist/catalog/catalog-v3/index.json');
    expect(deploy).toContain("PUBLIC_SITE_URL: https://${{ vars.CF_PAGES_PROJECT || 'dsh-go' }}.pages.dev");
    expect(deploy).toContain("PUBLIC_API_URL: https://${{ vars.CF_PAGES_PROJECT || 'dsh-go' }}.pages.dev");
    expect(deploy).toContain('Validate Cloudflare Pages file limits');
    expect(deploy).toContain('static_file_count=$(find site/dist -type f | wc -l | tr -d \' \')');
    expect(deploy).toContain('Cloudflare Pages static file count: $static_file_count/19000');
    expect(deploy).toContain('find site/dist -type f -size +26214400c');
    expect(deploy).toContain('pages deploy site/dist');
    expect(edgeone).toContain('Validate EdgeOne static file limits');
    expect(edgeone).toContain('static_file_count=$(find site/dist -type f | wc -l | tr -d \' \')');
    expect(edgeone).toContain('EdgeOne static file count: $static_file_count/19000');
    expect(edgeone).toContain('find site/dist -type f -size +26214400c');
    expect(gate).toContain('MAX_PUBLIC_REGISTRY_BYTES = 24 * 1024 * 1024');
    expect(gate).toContain('registry-v3.json exceeds the 24 MiB public single-file budget');
    expect(deploy).not.toContain('rm -f .deploy/cloudflare/catalog/plugins.json');
  });

  it('keeps the browser-only publisher directory compatible with inline scripts', () => {
    const page = readFileSync(join(root, 'site', 'src', 'pages', 'publishers', 'index.astro'), 'utf8');
    expect(page).toContain("fetch(registryUrl, { headers: { accept: 'application/json' } })");
    expect(page).not.toContain('await fetch(registryUrl');
    expect(page).toContain("u('/catalog/registry-v3.json')");
  });

  it('keeps the marketplace homepage bounded while preserving full-index browsing', () => {
    const page = readFileSync(join(root, 'site', 'src', 'components', 'UnifiedMarketplace.astro'), 'utf8');
    expect(page).toContain("data-market-index-url={u('/catalog/search-index-v2.json')}");
    expect(page).toContain('{popularItems.map');
    expect(page).not.toContain('{orderedItems.map');
    expect(page).toContain('fetchAllItems');
    expect(page).toContain('load-more');
  });

  it('keeps API documentation links on the configured API origin', () => {
    const docs = readFileSync(join(root, 'site', 'src', 'pages', 'docs.astro'), 'utf8');
    expect(docs).toContain('href={`${BASE}/api/v1/meta`}');
    expect(docs).not.toContain('href="/api/v1/meta"');
    expect(docs).toContain('curl "${BASE}/api/v1/plugins');
  });

  it('does not duplicate the repository base in canonical URLs', () => {
    const layout = readFileSync(join(root, 'site', 'src', 'layouts', 'Layout.astro'), 'utf8');
    expect(layout).toContain('const CANONICAL_URL = new URL(Astro.url.pathname, SITE).toString();');
    expect(layout).not.toContain('${SITE}${Astro.url.pathname}');
    const localized = readFileSync(join(root, 'site', 'src', 'pages', '[locale]', 'index.astro'), 'utf8');
    expect(localized).toContain('const absoluteUrl = (path: string) => new URL(path, SITE).toString();');
    expect(localized).not.toContain('${SITE}${u(');
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
    expect(edgeone).toContain("PUBLIC_API_URL: https://${{ vars.CF_PAGES_PROJECT || 'dsh-go' }}.pages.dev");
    expect(edgeone).not.toContain('PUBLIC_API_URL: ${{ env.EDGEONE_SITE_URL }}');
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

    const securityAudit = workflow('security-audit.yml');
    expect(securityAudit).toContain('npm-audit-retry.mjs');
    expect(securityAudit).toContain('GITHUB_WORKSPACE');
  });
});
