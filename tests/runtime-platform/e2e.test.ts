import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const { artifactIntegrity } = await import('../../scripts/checksum.mjs');
const { checkRuntimeHealth } = await import('../../runtime/health.mjs');
const { installPlugin } = await import('../../runtime/installer.mjs');
const { rollbackInstalledPath } = await import('../../runtime/rollback.mjs');
const { readInstallLock } = await import('../../runtime/verifier.mjs');

async function commitFixture(repo: string, version: string) {
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'fixture-plugin', version }, null, 2));
  await exec('git', ['add', 'package.json'], { cwd: repo });
  await exec('git', ['commit', '-m', `fixture ${version}`], { cwd: repo });
  return (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
}

function resolved(version: string, commit: string) {
  const source = { provider: 'github', repo: 'owner/fixture-plugin', ref: 'main', commit };
  return {
    id: 'fixture-plugin',
    version,
    channel: 'stable',
    repo: source.repo,
    ref: source.ref,
    commit,
    source,
    artifact: { integrity: artifactIntegrity({ version, source }) },
    integrity: artifactIntegrity({ version, source }),
    runtime: { type: 'plugin' },
    capabilities: ['plugin'],
    dependencies: [],
  };
}

describe('Runtime Platform V2 install/update/health/rollback E2E', () => {
  it('uses a real local git repository and atomic backup recovery', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-fixture-'));
    const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-'));
    await exec('git', ['init', '-q'], { cwd: fixture });
    await exec('git', ['config', 'user.email', 'runtime@test.local'], { cwd: fixture });
    await exec('git', ['config', 'user.name', 'Runtime Test'], { cwd: fixture });

    const firstCommit = await commitFixture(fixture, '0.1.0');
    const first = resolved('0.1.0', firstCommit);
    const installed = await installPlugin(first, { root, repositoryUrl: fixture });
    expect((await readInstallLock(installed.target)).version).toBe('0.1.0');

    const secondCommit = await commitFixture(fixture, '0.2.0');
    const second = resolved('0.2.0', secondCommit);
    const updated = await installPlugin(second, { root, repositoryUrl: fixture, force: true });
    expect(updated.backup).toBeTruthy();
    expect((await readInstallLock(updated.target)).version).toBe('0.2.0');

    const health = await checkRuntimeHealth({
      id: second.id,
      version: second.version,
      commit: second.commit,
      state: 'installed',
      path: updated.target,
      dependencies: [],
    });
    expect(health.status).toBe('healthy');

    const rolledBack = await rollbackInstalledPath(updated.target);
    expect(rolledBack.lock.version).toBe('0.1.0');
    expect((await readInstallLock(updated.target)).source.commit).toBe(firstCommit);
  });
});
