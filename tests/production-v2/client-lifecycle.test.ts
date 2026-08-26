import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const { artifactIntegrity } = await import('../../scripts/checksum.mjs');
const { installPlugin } = await import('../../runtime/installer.mjs');
const { loadInstalledPlugin } = await import('../../runtime/loader.mjs');
const { readInstallLock } = await import('../../runtime/verifier.mjs');

function git(repo: string, args: string[]) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

describe('client install -> manual restart -> startup loader E2E', () => {
  it('installs an immutable commit and activates only through the startup loader', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-client-fixture-'));
    const root = await mkdtemp(join(tmpdir(), 'dsh-client-runtime-'));
    git(fixture, ['init', '-q']);
    git(fixture, ['config', 'user.email', 'client-e2e@test.local']);
    git(fixture, ['config', 'user.name', 'Client E2E']);
    await writeFile(join(fixture, 'dsh-package.json'), JSON.stringify({
      manifest_version: '1.0.0', id: 'client-fixture', name: 'Client Fixture', version: '0.1.0', type: 'skill',
      permissions: [], compatibility: { node: '>=20.0.0', runtime: '>=0.1.0' },
      skill: { executor: 'node', entrypoint: 'index.js' },
    }, null, 2));
    await writeFile(join(fixture, 'index.js'), 'export default () => "ok";\n');
    git(fixture, ['add', 'dsh-package.json', 'index.js']);
    git(fixture, ['commit', '-m', 'fixture 0.1.0']);
    const commit = git(fixture, ['rev-parse', 'HEAD']);
    const source = { provider: 'github', repo: 'owner/client-fixture', ref: 'main', commit };
    const plugin = {
      id: 'client-fixture', version: '0.1.0', channel: 'stable', repo: source.repo, ref: source.ref, commit, source,
      artifact: { integrity: artifactIntegrity({ version: '0.1.0', source }) },
      integrity: artifactIntegrity({ version: '0.1.0', source }),
      runtime: { type: 'skill', activation: 'restart-required' }, capabilities: ['plugin', 'skill'], dependencies: [], permissions: [],
      compatibility: { node: '>=20.0.0', runtime: '>=0.1.0' },
    };

    const installed = await installPlugin(plugin, { root, repositoryUrl: fixture });
    const lock = await readInstallLock(installed.target);
    expect(installed.restart_required).toBe(true);
    expect(lock.restart_required).toBe(true);
    expect(lock.source.commit).toBe(commit);

    const activated = await loadInstalledPlugin('client-fixture', { root });
    expect(activated.activation).toBe('active');
    expect(activated.commit).toBe(commit);
    expect(activated.manifest_file).toBe('dsh-package.json');
    expect(activated.message).toContain('startup loader');
  });
});
