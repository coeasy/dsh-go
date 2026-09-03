import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { artifactIntegrity } from '../../scripts/checksum.mjs';
import { installPlugin } from '../../runtime/installer.mjs';
import { writeRuntimeRegistry } from '../../runtime/registry.mjs';
import { readInstallLock } from '../../runtime/verifier.mjs';

const exec = promisify(execFile);
const cli = join(process.cwd(), 'bin', 'dsh.mjs');

function git(repo: string, args: string[]) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'dsh-env-cli-fixture-'));
  const root = await mkdtemp(join(tmpdir(), 'dsh-env-cli-root-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'env-cli@test.local']);
  git(repo, ['config', 'user.name', 'Environment CLI Test']);
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'env-cli-fixture', version: '2.0.0' }, null, 2));
  await writeFile(join(repo, 'dsh-package.json'), JSON.stringify({ id: 'env-cli-fixture', type: 'plugin', version: '2.0.0' }, null, 2));
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'fixture']);
  const commit = git(repo, ['rev-parse', 'HEAD']);
  const source = { provider: 'github', repo: 'owner/env-cli-fixture', ref: 'main', commit };
  const integrity = artifactIntegrity({ version: '2.0.0', source });
  const installed = await installPlugin({
    id: 'env-cli-fixture', version: '2.0.0', channel: 'stable', repo: source.repo, ref: source.ref,
    commit, source, artifact: { kind: 'git-source', integrity }, integrity,
    runtime: { type: 'plugin' }, capabilities: ['plugin'], dependencies: [], permissions: [],
  }, { root: join(root, 'plugins'), repositoryUrl: repo });
  const installLock = await readInstallLock(installed.target);
  const registryFile = join(root, 'registry', 'runtime.json');
  await writeRuntimeRegistry({ schema_version: 3, generation: 0, packages: [{
    type: 'plugin', id: 'env-cli-fixture', version: '2.0.0', channel: 'stable', state: 'active',
    enabled: true, activated: true, restart_required: false, path: installed.target, commit,
    source: installLock.source, dependencies: [], history: [],
  }] }, registryFile);
  return {
    root, commit, target: installed.target, registryFile,
    lockFile: join(root, 'dsh.lock'), storeRoot: join(root, 'store', 'sha256'),
  };
}

async function run(args: string[]) {
  const result = await exec(process.execPath, [cli, '--json', ...args], { cwd: process.cwd(), encoding: 'utf8' });
  return JSON.parse(result.stdout);
}

describe('environment lock CLI', () => {
  it('runs lock, verify-lock, dry-run restore and approved restore through the public dsh entrypoint', async () => {
    const env = await fixture();
    const common = ['--file', env.lockFile, '--runtime-registry', env.registryFile, '--store', env.storeRoot];

    const locked = await run(['lock', ...common]);
    expect(locked).toMatchObject({ schema_version: 1, ok: true, command: 'lock' });
    expect(locked.data).toMatchObject({ file: env.lockFile, packages: 1 });

    const verified = await run(['verify-lock', ...common]);
    expect(verified).toMatchObject({ schema_version: 1, ok: true, command: 'verify-lock', data: { ok: true } });

    const dryRun = await run(['restore', ...common, '--dry-run']);
    expect(dryRun).toMatchObject({ schema_version: 1, ok: true, command: 'restore', data: { dry_run: true, executed: false, auto_restart: false } });

    await rm(env.target, { recursive: true, force: true });
    const restored = await run(['restore', ...common, '--yes']);
    expect(restored).toMatchObject({ schema_version: 1, ok: true, command: 'restore', data: { executed: true, restored: 1, auto_restart: false } });
    expect(git(env.target, ['rev-parse', 'HEAD'])).toBe(env.commit);

    const final = await run(['verify-lock', ...common]);
    expect(final.data.ok).toBe(true);
  }, 40_000);
});
