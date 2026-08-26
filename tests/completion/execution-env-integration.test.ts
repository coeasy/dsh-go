import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { invokeSkill } from '../../runtime/execution.mjs';
import { writeRuntimeRegistry } from '../../runtime/registry.mjs';

let previousHome: string | undefined;
let previousRegistry: string | undefined;
let previousSecret: string | undefined;
let root: string;
let registryFile: string;

beforeEach(async () => {
  previousHome = process.env.DSH_RUNTIME_HOME;
  previousRegistry = process.env.DSH_REGISTRY;
  previousSecret = process.env.DSH_TEST_HOST_SECRET;
  root = await mkdtemp(join(tmpdir(), 'dsh-execution-env-integration-'));
  registryFile = join(root, 'runtime.json');
  process.env.DSH_RUNTIME_HOME = root;
  process.env.DSH_REGISTRY = registryFile;
  process.env.DSH_TEST_HOST_SECRET = 'must-not-leak';
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_RUNTIME_HOME; else process.env.DSH_RUNTIME_HOME = previousHome;
  if (previousRegistry === undefined) delete process.env.DSH_REGISTRY; else process.env.DSH_REGISTRY = previousRegistry;
  if (previousSecret === undefined) delete process.env.DSH_TEST_HOST_SECRET; else process.env.DSH_TEST_HOST_SECRET = previousSecret;
});

describe('runtime execution environment integration', () => {
  it('keeps host secrets out while preserving explicit package env', async () => {
    const packageDir = join(root, 'skill-package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, 'index.mjs'), `
      console.log(JSON.stringify({
        hostSecret: process.env.DSH_TEST_HOST_SECRET || null,
        explicit: process.env.DSH_EXPLICIT_VISIBLE || null,
        hasPath: Boolean(process.env.PATH || process.env.Path),
      }));
    `);

    const permissions = ['process.spawn'];
    await writeRuntimeRegistry({ schema_version: 3, generation: 0, packages: [{
      type: 'skill', id: 'env-fixture', version: '0.1.0', state: 'active', channel: 'stable', enabled: true, activated: true,
      restart_required: false, path: packageDir, permissions,
      binding: {
        target: packageDir, transport: 'local', kind: 'skill', entrypoint: 'index.mjs', executor: 'node',
        declared_permissions: permissions, permission_policy: null,
        manifest: { skill: { executor: 'node', entrypoint: 'index.mjs', env: { DSH_EXPLICIT_VISIBLE: 'allowed' } } },
      },
    }] }, registryFile);

    const result = await invokeSkill('env-fixture', {}, { timeoutMs: 5000 });
    expect(result.output.hostSecret).toBeNull();
    expect(result.output.explicit).toBe('allowed');
    expect(result.output.hasPath).toBe(true);
  });
});
