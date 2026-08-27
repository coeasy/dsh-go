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

  it('monitors Provider Adapter Registry convergence across production hosts', () => {
    const monitor = workflow('monitor.yml');
    expect(monitor).toContain('/api/v1/providers?per_page=1');
    expect(monitor).toContain('PROVIDER_MAIN_HASH');
    expect(monitor).toContain('PROVIDER_MAIN_COUNT');
    expect(monitor).toContain('/catalog/provider-adapters.json');
    expect(monitor).toContain('GitHub Pages registries converged with main');
    expect(monitor).toContain('EdgeOne registries converged with main');
  });

  it('automatically removes merged same-repository branches and preserves a safe manual cleanup', () => {
    const hygiene = workflow('branch-hygiene.yml');
    expect(hygiene).toContain('types: [closed]');
    expect(hygiene).not.toContain('synchronize');
    expect(hygiene).toContain("github.event.pull_request.merged == true");
    expect(hygiene).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(hygiene).toContain("gh pr list --repo \"$GITHUB_REPOSITORY\" --state open");
    expect(hygiene).toContain('compare/${base_encoded}...${encoded}');
    expect(hygiene).toContain('git/refs/heads/$encoded');
  });
});
