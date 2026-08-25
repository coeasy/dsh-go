import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const {
  checkForRuntimeUpdate,
  findDshOnPath,
  runtimeEnvironment,
  updateRuntime,
} = await import('../../runtime/self-update.mjs');

describe('Phase 7 runtime diagnostics and self-update', () => {
  it('detects a dsh command exposed on PATH', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-path-'));
    const command = join(dir, 'dsh');
    await writeFile(command, '#!/bin/sh\n');
    expect(await findDshOnPath({ env: { PATH: `${dir}${delimiter}/usr/bin` }, platform: 'linux' })).toBe(command);

    const info = await runtimeEnvironment('2.3.0', {
      env: { PATH: dir },
      platform: 'linux',
      arch: 'x64',
      nodeVersion: '22.12.0',
    });
    expect(info.path_registered).toBe(true);
    expect(info.node_supported).toBe(true);
    expect(info.runtime_version).toBe('2.3.0');
  });

  it('checks GitHub releases and builds an explicit dry-run update plan', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v2.4.0', html_url: 'https://github.com/coeasy/dsh-go/releases/tag/v2.4.0' }),
    });
    const check = await checkForRuntimeUpdate('2.3.0', { fetchImpl });
    expect(check.update_available).toBe(true);
    expect(check.latest_version).toBe('2.4.0');

    const plan = await updateRuntime('2.3.0', { fetchImpl, dryRun: true });
    expect(plan.updated).toBe(false);
    expect('dry_run' in plan ? plan.dry_run : false).toBe(true);
    expect('install_spec' in plan ? plan.install_spec : null).toBe('github:coeasy/dsh-go#v2.4.0');
  });
});
