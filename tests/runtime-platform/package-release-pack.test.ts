import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function git(root: string, args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

async function writeFixture(root: string) {
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture-package', version: '0.1.0' }, null, 2));
  await writeFile(join(root, 'index.mjs'), 'export default () => "ok";\n');
  await writeFile(join(root, 'dsh-package.json'), JSON.stringify({
    manifest_version: '1.0.0',
    id: 'fixture-package',
    name: 'Fixture Package',
    version: '0.1.0',
    type: 'plugin',
    capabilities: ['plugin'],
    dependencies: [],
    permissions: [],
    compatibility: { os: ['linux', 'darwin', 'win32'], node: '>=20.0.0', runtime: '>=0.1.0' },
    plugin: { entrypoint: 'index.mjs' },
  }, null, 2));
}

describe('ecosystem package release packer', () => {
  it('produces a commit-bound reproducible archive and release descriptor', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-package-release-'));
    const outA = join(fixture, '.release-a');
    const outB = join(fixture, '.release-b');
    git(fixture, ['init', '-q']);
    git(fixture, ['config', 'user.email', 'release@test.local']);
    git(fixture, ['config', 'user.name', 'Release Test']);
    await writeFixture(fixture);
    git(fixture, ['add', 'package.json', 'index.mjs', 'dsh-package.json']);
    git(fixture, ['commit', '-m', 'fixture release']);
    const commit = git(fixture, ['rev-parse', 'HEAD']);
    const script = resolve('scripts/package-release-pack.mjs');

    const common = [
      script,
      '--root', fixture,
      '--repository', 'owner/fixture-package',
      '--commit', commit,
      '--tag', 'v0.1.0',
      '--channel', 'stable',
    ];
    execFileSync(process.execPath, [...common, '--out-dir', outA], { cwd: process.cwd(), stdio: 'pipe' });
    execFileSync(process.execPath, [...common, '--out-dir', outB], { cwd: process.cwd(), stdio: 'pipe' });

    const archiveName = 'fixture-package-0.1.0.tgz';
    expect(await readFile(join(outA, archiveName))).toEqual(await readFile(join(outB, archiveName)));
    expect(await readFile(join(outA, 'dsh-package-release.json'))).toEqual(await readFile(join(outB, 'dsh-package-release.json')));
    expect(await readFile(join(outA, 'dsh-package-sbom.cdx.json'))).toEqual(await readFile(join(outB, 'dsh-package-sbom.cdx.json')));
    expect(await readFile(join(outA, 'SHA256SUMS'))).toEqual(await readFile(join(outB, 'SHA256SUMS')));

    const descriptor = JSON.parse(await readFile(join(outA, 'dsh-package-release.json'), 'utf8'));
    expect(descriptor).toMatchObject({
      release_version: 1,
      id: 'fixture-package',
      type: 'plugin',
      version: '0.1.0',
      repository: 'owner/fixture-package',
      commit,
      tag: 'v0.1.0',
      artifact: {
        kind: 'release-archive',
        format: 'tgz',
        strip_components: 1,
      },
    });
    expect(descriptor.artifact.url).toBe('https://github.com/owner/fixture-package/releases/download/v0.1.0/fixture-package-0.1.0.tgz');
    expect(descriptor.artifact.digest).toMatch(/^sha256-[0-9a-f]{64}$/);
  });
});
