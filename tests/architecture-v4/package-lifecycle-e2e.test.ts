import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRegistryV4 } from '../../packages/registry-core/index.mjs';
import { installPackageRequest, packageInfo, removePackageRequest, verifyPackageRequest } from '../../runtime/package-service.mjs';
import { activatePendingPackages } from '../../runtime/startup.mjs';
import { readRuntimeRegistry } from '../../runtime/registry.mjs';

const exec = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function fixtureRepository() {
  const repo = await mkdtemp(join(tmpdir(), 'dsh-v4-repo-'));
  dirs.push(repo);
  await exec('git', ['init', '-q'], { cwd: repo, windowsHide: true });
  await exec('git', ['config', 'user.email', 'dsh-test@example.invalid'], { cwd: repo, windowsHide: true });
  await exec('git', ['config', 'user.name', 'DSH Test'], { cwd: repo, windowsHide: true });
  await writeFile(join(repo, 'dsh-package.json'), JSON.stringify({
    manifest_version: 2,
    type: 'skill',
    id: 'owner/e2e',
    version: '1.0.0',
    channel: 'stable',
    name: 'E2E Skill',
    description: 'Runtime lifecycle fixture for canonical Manifest V2.',
    capabilities: ['skill'],
    permissions: [],
    dependencies: [],
    compatibility: {},
    entrypoints: { main: 'SKILL.md' },
    runtime: { type: 'skill', executor: 'markdown' },
    publisher: { id: 'owner' },
    security: {},
    metadata: { category: 'skills' },
    source: { provider: 'github', repo: 'owner/e2e' },
  }, null, 2));
  await writeFile(join(repo, 'SKILL.md'), '# E2E Skill\n');
  await exec('git', ['add', '.'], { cwd: repo, windowsHide: true });
  await exec('git', ['commit', '-qm', 'fixture'], { cwd: repo, windowsHide: true });
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo, windowsHide: true });
  return { repo, commit: stdout.trim().toLowerCase() };
}

describe('Canonical package lifecycle E2E', () => {
  it('resolves, installs, persists, activates, verifies and removes one package', async () => {
    const fixture = await fixtureRepository();
    const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-v4-runtime-'));
    dirs.push(runtimeHome);
    const packageHome = join(runtimeHome, 'packages', 'skill');
    const registryFile = join(runtimeHome, 'state', 'runtime-v4.json');
    const registry = buildRegistryV4([{
      type: 'skill',
      id: 'owner/e2e',
      version: '1.0.0',
      channel: 'stable',
      source: { provider: 'github', repo: 'owner/e2e', commit: fixture.commit },
      artifact: { kind: 'git-source' },
      capabilities: ['skill'],
      permissions: [],
      dependencies: [],
      compatibility: {},
      security: {},
      publisher: { id: 'owner', repository_ownership: 'verified', verified: true },
      metadata: { name: 'E2E Skill', stars: 250, verified: true },
    }], { generated_at: '2026-09-04T00:00:00.000Z' });

    const installed = await installPackageRequest('skill:owner/e2e@1.0.0', {
      registryData: registry,
      registryFile,
      root: packageHome,
      repositoryUrl: fixture.repo,
      approved: true,
      releaseDiscovery: false,
    });
    expect(installed.changed).toBe(true);
    expect(installed.restart_required).toBe(true);
    expect(installed.plan.order).toEqual(['skill:owner/e2e']);

    let state = await readRuntimeRegistry(registryFile);
    expect(state.schema_version).toBe(4);
    expect(state.packages).toHaveLength(1);
    expect(state.packages[0]).toMatchObject({ type: 'skill', id: 'owner/e2e', state: 'pending-restart', activated: false, restart_required: true });
    expect(state).not.toHaveProperty('plugins');

    const activated = await activatePendingPackages({ registryFile });
    expect(activated.healthy).toBe(true);
    expect(activated.activated).toHaveLength(1);
    state = await readRuntimeRegistry(registryFile);
    expect(state.packages[0]).toMatchObject({ state: 'active', activated: true, restart_required: false });

    const info = await packageInfo('skill:owner/e2e@*', { registryFile });
    expect(info.binding).toMatchObject({ kind: 'skill', manifest_file: 'dsh-package.json' });
    const verified = await verifyPackageRequest('skill:owner/e2e@*', { registryFile });
    expect(verified.ok).toBe(true);
    expect(verified.commit).toBe(fixture.commit);
    const lock = JSON.parse(await readFile(join(info.path, '.dsh-install.json'), 'utf8'));
    expect(lock).toMatchObject({ schema_version: 4, runtime_state_version: 4, protocol_version: 2, id: 'owner/e2e', type: 'skill' });

    const removed = await removePackageRequest('skill:owner/e2e@*', { registryFile, approved: true });
    expect(removed.changed).toBe(true);
    state = await readRuntimeRegistry(registryFile);
    expect(state.packages[0]).toMatchObject({ state: 'removed', enabled: false, activated: false });
  }, 30_000);
});
