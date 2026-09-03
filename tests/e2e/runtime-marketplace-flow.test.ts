import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const { artifactIntegrity } = await import('../../scripts/checksum.mjs');
const cli = join(process.cwd(), 'bin', 'dsh.mjs');

describe('final acceptance: marketplace to runtime flow', () => {
  it('routes a canonical Marketplace deep link into a local non-mutating install plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-e2e-marketplace-'));
    const registryFile = join(root, 'registry-v3.json');
    const source = {
      provider: 'github',
      repo: 'owner/marketplace-acceptance',
      ref: 'main',
      commit: '0123456789012345678901234567890123456789',
    };
    const integrity = artifactIntegrity({ version: '1.0.0', source });

    await writeFile(registryFile, JSON.stringify({
      registry_version: 3,
      schema_version: '3.0.0',
      defaults: { plugin_version: '1.0.0' },
      plugins: [{
        id: 'marketplace-acceptance',
        version: '1.0.0',
        channel: 'stable',
        source,
        artifact: { integrity },
        runtime: { type: 'plugin' },
        capabilities: ['plugin'],
        dependencies: [],
      }],
    }, null, 2));

    const uriResult = await exec(process.execPath, [
      cli,
      'host',
      'uri',
      'plugin:marketplace-acceptance@1.0.0',
      '--channel',
      'stable',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    const uri = uriResult.stdout.trim();
    expect(uri).toBe('dsh://plugin/install/marketplace-acceptance%401.0.0?channel=stable');

    const planResult = await exec(process.execPath, [
      cli,
      'host',
      'handle',
      uri,
      '--dry-run',
      '--registry',
      registryFile,
      '--root',
      root,
    ], { cwd: process.cwd(), encoding: 'utf8' });

    const plan = JSON.parse(planResult.stdout);
    expect(plan.id).toBe('marketplace-acceptance');
    expect(plan.version).toBe('1.0.0');
    expect(plan.restart_required).toBe(false);
    expect(plan.dependency_order).toEqual(['marketplace-acceptance']);
    expect(plan.results).toHaveLength(1);
    expect(plan.results[0].target).toContain('marketplace-acceptance');
  }, 20_000);
});
