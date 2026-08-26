import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);

describe('dsh doctor CLI', () => {
  it('exposes unified read-only diagnostics from the official entrypoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-doctor-cli-'));
    const registryFile = join(root, 'registry', 'runtime.json');
    await mkdir(dirname(registryFile), { recursive: true });
    await writeFile(registryFile, `${JSON.stringify({ schema_version: 3, generation: 0, packages: [] })}\n`);

    const { stdout } = await exec(process.execPath, ['bin/dsh.mjs', 'doctor', '--quick'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DSH_RUNTIME_HOME: root,
        DSH_RUNTIME_REGISTRY: registryFile,
        DSH_REGISTRY_CACHE: join(root, 'cache', 'registry-v3.json'),
        DSH_TRANSACTION_HOME: join(root, 'transactions'),
        DSH_CATALOG_REGISTRY: '',
        DSH_REGISTRY: '',
      },
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });

    const result = JSON.parse(stdout);
    expect(result.status).toBe('healthy');
    expect(result.runtime.runtime_version).toBe('0.1.0');
    expect(result.registry.runtime.file).toBe(registryFile);
    expect(result.summary.total).toBe(0);
    expect(result.packages).toEqual([]);
  });
});
