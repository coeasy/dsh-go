import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const { artifactIntegrity } = await import('../../scripts/checksum.mjs');
const cli = join(process.cwd(), 'bin', 'dsh.mjs');

describe('Phase 7 browser-to-runtime E2E', () => {
  it('routes a dsh:// install request through the host bridge into a dry-run Runtime install plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-client-bridge-root-'));
    const registryFile = join(root, 'registry-v3.json');
    const source = {
      provider: 'github',
      repo: 'owner/bridge-fixture',
      ref: 'main',
      commit: '0123456789012345678901234567890123456789',
    };
    const integrity = artifactIntegrity({ version: '0.1.0', source });
    await writeFile(registryFile, JSON.stringify({
      registry_version: 3,
      schema_version: '3.0.0',
      defaults: { plugin_version: '0.1.0' },
      plugins: [{
        id: 'bridge-fixture',
        version: '0.1.0',
        channel: 'stable',
        source,
        artifact: { integrity },
        runtime: { type: 'plugin' },
        capabilities: ['plugin'],
        dependencies: [],
      }],
    }, null, 2));

    const result = await exec(process.execPath, [
      cli,
      'host',
      'handle',
      'dsh://plugin/install/bridge-fixture%400.1.0',
      '--dry-run',
      '--registry',
      registryFile,
      '--root',
      root,
    ], { cwd: process.cwd(), encoding: 'utf8' });

    const plan = JSON.parse(result.stdout);
    expect(plan.id).toBe('bridge-fixture');
    expect(plan.version).toBe('0.1.0');
    expect(plan.restart_required).toBe(false);
    expect(plan.dependency_order).toEqual(['bridge-fixture']);
    expect(plan.results[0].target).toContain('bridge-fixture');
  });
});
